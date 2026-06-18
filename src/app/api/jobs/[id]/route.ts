// src/app/api/jobs/[id]/route.ts
// GET    -> single job, with applicants joined
// PATCH  -> update job fields (manual edits, or filling in ATS/LinkedIn details by hand)
// DELETE -> remove a job (cascades to its applications)

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { categorizeJob } from "@/lib/jobCategorizer";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, applications(id, status, candidates(id, name))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const categoryFallback = job.job_category ? {} : categorizeJob([
    job.title,
    job.description_text,
    job.notes,
    job.job_function,
    job.industries,
    job.company_description,
  ]);

  return NextResponse.json({
    ...job,
    ...categoryFallback,
    applicants: (job.applications ?? []).map((a: any) => ({
      application_id: a.id,
      candidate_id: a.candidates?.id,
      name: a.candidates?.name,
      status: a.status,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  const allowedFields = [
    "title", "company", "location", "role_tier", "salary_range", "source_url", "notes",
    "is_active", "seniority_level", "employment_type", "applicants_count",
    "company_employees_count", "company_website", "posted_at",
    "external_job_id", "tracking_id", "ref_id", "apply_url", "description_html",
    "description_text", "benefits", "job_function", "industries", "input_url",
    "company_linkedin_url", "company_logo_url", "company_address", "company_slogan",
    "company_description", "job_poster_name", "job_poster_title",
    "job_poster_profile_url", "job_poster_photo_url", "raw_source_payload",
    "job_category", "category_tags", "category_relevance_score",
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
  await syncCompanyDirectoryFromJobs([data]);
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { error } = await supabase.from("jobs").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
