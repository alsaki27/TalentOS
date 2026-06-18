// src/app/api/follow-ups/route.ts
// GET -> every application with a follow-up date set, joined with candidate + job info,
// soonest first.

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
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("applications")
    .select("id, status, follow_up_at, follow_up_source, follow_up_created_at, assigned_to, assigned_to_user_id, next_action, candidates(id, name), jobs(id, title, company)")
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

  const { data, error } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
