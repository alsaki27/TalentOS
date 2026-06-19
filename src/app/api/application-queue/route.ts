// src/app/api/application-queue/route.ts
// GET -> paginated/filterable assigned/stacked application work tickets

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const owner = url.searchParams.get("owner") || "";
  const priority = url.searchParams.get("priority") || "";
  const review = url.searchParams.get("review") || "";
  const view = url.searchParams.get("view") || "all";

  const selectString = `
    id,
    status,
    assigned_by,
    assigned_to,
    assigned_by_user_id,
    assigned_to_user_id,
    assignment_note,
    assignment_due_at,
    priority,
    review_status,
    review_note,
    reviewed_at,
    next_action,
    notes,
    applied_at,
    proof_url,
    proof_filename,
    proof_uploaded_at,
    candidates(id, name, email, phone, resume_url, resume_filename),
    jobs(id, title, company, location, source_url, job_category, category_relevance_score)
  `;

  let query = supabase.from("applications").select(selectString, { count: "exact" })
    .in("status", ["assigned", "stacked", "in_progress"]);

  if (context?.profile.role === "application_engineer") {
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
  if (owner) {
    query = query.or(`assigned_to_user_id.eq.${owner},assigned_to.eq.${owner}`);
  }
  if (priority) query = query.eq("priority", priority);
  if (review) query = query.eq("review_status", review);

  const today = new Date().toISOString().slice(0, 10);
  if (view === "mine") {
    query = query.eq("assigned_to_user_id", context!.profile.user_id);
  } else if (view === "overdue") {
    query = query.not("assignment_due_at", "is", null).lte("assignment_due_at", today);
  } else if (view === "review") {
    query = query.eq("review_status", "pending");
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("assignment_due_at", { ascending: true, nullsFirst: false })
    .order("applied_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userId = context!.profile.user_id;
  const userEmail = context!.profile.email ?? null;
  const userDisplayName = context!.profile.display_name ?? null;
  const userRole = context!.profile.role;

  function buildStatsBase() {
    let q = supabase.from("applications").select("id", { count: "exact", head: true })
      .in("status", ["assigned", "stacked", "in_progress"]);
    if (userRole === "application_engineer") {
      const ownerFilters = [
        `assigned_to_user_id.eq.${userId}`,
        userEmail ? `assigned_to.eq.${userEmail}` : "",
        userDisplayName ? `assigned_to.eq.${userDisplayName}` : "",
      ].filter(Boolean).join(",");
      q = q.or(ownerFilters);
    }
    return q;
  }

  const [allRes, mineRes, overdueRes, reviewRes] = await Promise.all([
    buildStatsBase(),
    buildStatsBase().eq("assigned_to_user_id", userId),
    buildStatsBase().not("assignment_due_at", "is", null).lte("assignment_due_at", today),
    buildStatsBase().eq("review_status", "pending"),
  ]);

  const stats = {
    all: allRes.count ?? 0,
    mine: mineRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    pendingReview: reviewRes.count ?? 0,
  };

  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize, stats });
}
