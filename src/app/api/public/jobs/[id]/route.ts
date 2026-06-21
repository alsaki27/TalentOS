import { NextRequest, NextResponse } from "next/server";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { updateJob, deleteJob } from "@/server/repositories/jobsRepository";

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

  if (isNeon()) {
    const data = await queryOne<any>(`
      SELECT j.*,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              'id', a.id, 'status', a.status, 'applied_at', a.applied_at,
              'candidates', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email)
            )
          ) FROM applications a LEFT JOIN candidates c ON c.id = a.candidate_id WHERE a.job_id = j.id),
          '[]'::jsonb
        ) as applications
      FROM jobs j
      WHERE j.id = $1
    `, [params.id]);

    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("jobs")
      .select("*, applications(id, status, applied_at, candidates(id, name, email))")
      .eq("id", params.id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json(data);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:write");
  if (response) return response;

  const body = await req.json();
  const updates: Record<string, unknown> = pickFields(body, JOB_FIELDS);
  if ("job_category" in body) {
    updates.category_status = "done";
  } else if (body.title || body.description_text || body.notes || body.job_function || body.industries || body.company_description) {
    updates.category_status = "pending";
    updates.job_category = null;
    updates.ai_suggested_category = null;
  }

  if (isNeon()) {
    try {
      const data = await updateJob(params.id, updates);
      await syncCompanyDirectoryFromJobs([data]);
      return NextResponse.json(data);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.from("jobs").update(updates).eq("id", params.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncCompanyDirectoryFromJobs([data]);
    return NextResponse.json(data);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:delete");
  if (response) return response;

  if (isNeon()) {
    try {
      await deleteJob(params.id);
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.from("jobs").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
}
