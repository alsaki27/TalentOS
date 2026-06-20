import { NextRequest, NextResponse } from "next/server";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { filterNewJobs } from "@/lib/jobDedup";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { createJob } from "@/server/repositories/jobsRepository";

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

  if (isNeon()) {
    const offset = from;
    const searchParam = `%${search}%`;
    const conditions: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(title ILIKE $${idx++} OR company ILIKE $${idx++} OR location ILIKE $${idx++})`);
      values.push(searchParam, searchParam, searchParam);
    }
    if (source) {
      conditions.push(`source = $${idx++}`);
      values.push(source);
    }
    if (category) {
      conditions.push(`(job_category = $${idx++} OR category_tags @> jsonb_build_array($${idx++}))`);
      values.push(category, category);
    }
    if (active === "true" || active === "active") {
      conditions.push(`is_active = true`);
    }
    if (active === "false" || active === "inactive") {
      conditions.push(`is_active = false`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int as total FROM jobs ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, [...values]);
    const total = countRow?.total ?? 0;

    const dataSql = `SELECT id, company_id, title, company, location, source, role_tier, salary_range, source_url, is_active, employment_type, applicants_count, company_website, posted_at, external_job_id, apply_url, job_category, category_tags, category_relevance_score, category_status, salary_min, salary_max, salary_currency, salary_period, work_authorization, last_seen_at, created_at FROM jobs ${where} ORDER BY created_at DESC OFFSET $${idx++} LIMIT $${idx++}`;
    values.push(offset, pageSize);

    const data = await query<any>(dataSql, values);
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    let query = supabase
      .from("jobs")
      .select("id, company_id, title, company, location, source, role_tier, salary_range, source_url, is_active, employment_type, applicants_count, company_website, posted_at, external_job_id, apply_url, job_category, category_tags, category_relevance_score, category_status, salary_min, salary_max, salary_currency, salary_period, work_authorization, last_seen_at, created_at", { count: "planned" })
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
    // job_category left unset when the caller doesn't supply one — category_status
    // defaults to 'pending' and the AI categorization pass fills it in afterward.
    ...("job_category" in body ? { category_status: "done" } : {}),
  };

  const { newRows } = await filterNewJobs([row]);
  if (newRows.length === 0) {
    return NextResponse.json({ error: "Duplicate job." }, { status: 409 });
  }

  if (isNeon()) {
    try {
      const data = await createJob(row);
      await syncCompanyDirectoryFromJobs([data]);
      return NextResponse.json(data, { status: 201 });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } else {
    const { data, error } = await supabase.from("jobs").insert(row).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncCompanyDirectoryFromJobs([data]);
    return NextResponse.json(data, { status: 201 });
  }
}
