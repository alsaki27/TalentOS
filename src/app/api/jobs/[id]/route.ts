// src/app/api/jobs/[id]/route.ts
// GET    -> single job, with applicants joined
// PATCH  -> update job fields (manual edits, or filling in ATS/LinkedIn details by hand)
// DELETE -> remove a job (cascades to its applications)

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, applications(id, status, candidates(id, name))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  return NextResponse.json({
    ...job,
    applicants: (job.applications ?? []).map((a: any) => ({
      application_id: a.id,
      candidate_id: a.candidates?.id,
      name: a.candidates?.name,
      status: a.status,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  const allowedFields = [
    "title", "company", "location", "role_tier", "salary_range", "source_url", "notes",
    "is_active", "seniority_level", "employment_type", "applicants_count",
    "company_employees_count", "company_website", "posted_at",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("jobs")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from("jobs").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
