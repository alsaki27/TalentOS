import { NextRequest, NextResponse } from "next/server";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { filterNewJobs } from "@/lib/jobDedup";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "jobs:import");
  if (response) return response;

  const body = await req.json().catch(() => null);
  const rows = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
  if (rows.length === 0) return NextResponse.json({ error: "jobs array is required" }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ error: "Import limit is 500 jobs per request." }, { status: 400 });

  const normalizedRows = rows
    .filter((row: any) => row?.title)
    .map((row: any) => ({
      title: row.title,
      company: row.company ?? null,
      location: row.location ?? null,
      source: row.source ?? "public_api_import",
      role_tier: row.role_tier ?? null,
      salary_range: row.salary_range ?? null,
      source_url: row.source_url ?? null,
      notes: row.notes ?? null,
      is_active: row.is_active ?? true,
      seniority_level: row.seniority_level ?? null,
      employment_type: row.employment_type ?? null,
      applicants_count: row.applicants_count ?? null,
      company_employees_count: row.company_employees_count ?? null,
      company_website: row.company_website ?? null,
      posted_at: row.posted_at || null,
      external_job_id: row.external_job_id ?? null,
      tracking_id: row.tracking_id ?? null,
      ref_id: row.ref_id ?? null,
      apply_url: row.apply_url ?? null,
      description_html: row.description_html ?? null,
      description_text: row.description_text ?? null,
      benefits: row.benefits ?? null,
      job_function: row.job_function ?? null,
      industries: row.industries ?? null,
      input_url: row.input_url ?? null,
      company_linkedin_url: row.company_linkedin_url ?? null,
      company_logo_url: row.company_logo_url ?? null,
      company_address: row.company_address ?? null,
      company_slogan: row.company_slogan ?? null,
      company_description: row.company_description ?? null,
      job_poster_name: row.job_poster_name ?? null,
      job_poster_title: row.job_poster_title ?? null,
      job_poster_profile_url: row.job_poster_profile_url ?? null,
      job_poster_photo_url: row.job_poster_photo_url ?? null,
      raw_source_payload: row.raw_source_payload ?? row,
      // job_category left unset when the caller doesn't supply one — category_status
      // defaults to 'pending' and the AI categorization pass fills it in afterward.
      ...(row.job_category ? {
        job_category: row.job_category,
        category_tags: row.category_tags ?? [],
        category_relevance_score: row.category_relevance_score ?? null,
        category_status: "done",
      } : {}),
    }));

  const { newRows, duplicates } = await filterNewJobs(normalizedRows);
  const { data, error } = newRows.length
    ? await supabase.from("jobs").insert(newRows).select("*")
    : { data: [], error: null };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data?.length) await syncCompanyDirectoryFromJobs(data);

  return NextResponse.json({
    imported: data?.length ?? 0,
    skipped: duplicates,
    jobs: data ?? [],
  }, { status: 201 });
}
