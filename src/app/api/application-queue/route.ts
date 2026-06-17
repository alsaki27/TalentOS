// src/app/api/application-queue/route.ts
// GET -> assigned/stacked application work tickets for the Application Engineer dashboard.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("applications")
    .select(`
      id,
      status,
      assigned_by,
      assigned_to,
      assignment_note,
      assignment_due_at,
      next_action,
      notes,
      applied_at,
      candidates(id, name, email, phone, resume_url, resume_filename),
      jobs(id, title, company, location, source_url, job_category, category_relevance_score)
    `)
    .in("status", ["assigned", "stacked", "in_progress"])
    .order("assignment_due_at", { ascending: true, nullsFirst: false })
    .order("applied_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
