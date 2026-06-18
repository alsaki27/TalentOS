import { NextRequest, NextResponse } from "next/server";
import { categorizeJob } from "@/lib/jobCategorizer";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const JOB_FIELDS = [
  "title", "company", "location", "source", "role_tier", "salary_range", "source_url",
  "notes", "is_active", "seniority_level", "employment_type", "applicants_count",
  "company_employees_count", "company_website", "posted_at", "external_job_id",
  "tracking_id", "ref_id", "apply_url", "description_html", "description_text",
  "benefits", "job_function", "industries", "input_url", "company_linkedin_url",
  "company_logo_url", "company_address", "company_slogan", "company_description",
  "job_poster_name", "job_poster_title", "job_poster_profile_url", "job_poster_photo_url",
  "raw_source_payload", "job_category", "category_tags", "category_relevance_score",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:read");
  if (response) return response;

  const { data, error } = await supabase
    .from("jobs")
    .select("*, applications(id, status, applied_at, candidates(id, name, email))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:write");
  if (response) return response;

  const body = await req.json();
  const updates = pickFields(body, JOB_FIELDS);
  if (!("job_category" in body) && (body.title || body.description_text || body.notes)) {
    Object.assign(updates, categorizeJob([
      String(body.title ?? ""),
      String(body.description_text ?? ""),
      String(body.notes ?? ""),
      String(body.job_function ?? ""),
      String(body.industries ?? ""),
      String(body.company_description ?? ""),
    ]));
  }

  const { data, error } = await supabase.from("jobs").update(updates).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncCompanyDirectoryFromJobs([data]);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:delete");
  if (response) return response;

  const { error } = await supabase.from("jobs").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
