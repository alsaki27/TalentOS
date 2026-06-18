// src/app/api/application-queue/route.ts
// GET -> assigned/stacked application work tickets for the Application Engineer dashboard.

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
  const from = (page - 1) * pageSize;

  const { data, error } = await supabase
    .from("applications")
    .select(`
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
      candidates(id, name, email, phone, resume_url, resume_filename),
      jobs(id, title, company, location, source_url, job_category, category_relevance_score)
    `)
    .in("status", ["assigned", "stacked", "in_progress"])
    .order("assignment_due_at", { ascending: true, nullsFirst: false })
    .order("applied_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (context?.profile.role === "application_engineer") {
    const displayName = context.profile.display_name;
    const email = context.profile.email;
    return NextResponse.json((data ?? []).filter((item) => (
      item.assigned_to_user_id === context.profile.user_id
      || (displayName && item.assigned_to === displayName)
      || (email && item.assigned_to === email)
    )));
  }

  return NextResponse.json(data ?? []);
}
