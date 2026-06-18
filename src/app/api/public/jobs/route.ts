import { NextRequest, NextResponse } from "next/server";
import { categorizeJob } from "@/lib/jobCategorizer";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { filterNewJobs } from "@/lib/jobDedup";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
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

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "jobs:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const source = url.searchParams.get("source") || "";
  const category = url.searchParams.get("category") || "";
  const active = url.searchParams.get("active") || "";

  let query = supabase
    .from("jobs")
    .select("id, company_id, title, company, location, source, role_tier, salary_range, source_url, is_active, employment_type, applicants_count, company_website, posted_at, external_job_id, apply_url, job_category, category_tags, category_relevance_score, last_seen_at, created_at", { count: "planned" })
    .order("created_at", { ascending: false });

  if (search) query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
  if (source) query = query.eq("source", source);
  if (category) query = query.or(`job_category.eq.${category},category_tags.cs.{"${category}"}`);
  if (active === "true" || active === "active") query = query.eq("is_active", true);
  if (active === "false" || active === "inactive") query = query.eq("is_active", false);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "jobs:write");
  if (response) return response;

  const body = await req.json();
  if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const row: any = {
    ...pickFields(body, JOB_FIELDS),
    source: body.source ?? "public_api",
    is_active: body.is_active ?? true,
    ...("job_category" in body ? {} : categorizeJob([
      body.title,
      body.description_text,
      body.notes,
      body.job_function,
      body.industries,
      body.company_description,
    ])),
  };

  const { newRows } = await filterNewJobs([row]);
  if (newRows.length === 0) {
    return NextResponse.json({ error: "Duplicate job." }, { status: 409 });
  }

  const { data, error } = await supabase.from("jobs").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncCompanyDirectoryFromJobs([data]);
  return NextResponse.json(data, { status: 201 });
}
