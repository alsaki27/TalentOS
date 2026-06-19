// src/app/api/follow-ups/route.ts
// GET -> paginated/filterable follow-ups, joined with candidate + job info

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const dueFilter = url.searchParams.get("dueFilter") || "";

  let query = supabase
    .from("applications")
    .select("id, status, follow_up_at, follow_up_source, follow_up_created_at, assigned_to, assigned_to_user_id, next_action, candidates(id, name), jobs(id, title, company)", { count: "exact" })
    .not("follow_up_at", "is", null)
    .order("follow_up_at", { ascending: true });

  if (context.profile.role === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${context.profile.user_id}`,
      context.profile.email ? `assigned_to.eq.${context.profile.email}` : "",
      context.profile.display_name ? `assigned_to.eq.${context.profile.display_name}` : "",
    ].filter(Boolean).join(",");
    query = query.or(ownerFilters);
  }

  if (search) {
    query = query.or(`candidates.name.ilike.%${search}%,jobs.title.ilike.%${search}%,jobs.company.ilike.%${search}%`);
  }
  if (status) query = query.eq("status", status);

  const today = new Date().toISOString().slice(0, 10);
  if (dueFilter === "overdue") query = query.lte("follow_up_at", today);
  if (dueFilter === "upcoming") query = query.gt("follow_up_at", today);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute cross-page stats
  function buildStatsBase() {
    let q = supabase.from("applications").select("id", { count: "exact", head: true })
      .not("follow_up_at", "is", null);
    if (context.profile.role === "application_engineer") {
      const ownerFilters = [
        `assigned_to_user_id.eq.${context.profile.user_id}`,
        context.profile.email ? `assigned_to.eq.${context.profile.email}` : "",
        context.profile.display_name ? `assigned_to.eq.${context.profile.display_name}` : "",
      ].filter(Boolean).join(",");
      q = q.or(ownerFilters);
    }
    return q;
  }

  const [allRes, dueRes, upcomingRes, autoRes] = await Promise.all([
    buildStatsBase(),
    buildStatsBase().lte("follow_up_at", today),
    buildStatsBase().gt("follow_up_at", today),
    buildStatsBase().eq("follow_up_source", "auto_status_rule"),
  ]);

  const stats = {
    all: allRes.count ?? 0,
    due: dueRes.count ?? 0,
    upcoming: upcomingRes.count ?? 0,
    auto: autoRes.count ?? 0,
    manual: (allRes.count ?? 0) - (autoRes.count ?? 0),
  };

  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize, stats });
}
