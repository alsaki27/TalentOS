import { NextRequest, NextResponse } from "next/server";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
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
    conditions.push(`(job_category = $${idx++} OR $${idx++} = ANY(category_tags))`);
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
    ...("job_category" in body ? { category_status: "done" } : {}),
  };

  try {
    const outcome = await createJob(row);
    if (outcome.status === "duplicate") {
      return NextResponse.json(
        {
          error: "duplicate_job",
          message: `This job was not added because a posting with the same apply link is already in TalentOS: "${outcome.existing.title}" at ${outcome.existing.company ?? "an unspecified company"}.`,
          attempted: { title: row.title, company: row.company ?? null, applyUrl: row.apply_url ?? row.source_url ?? null },
          existingJob: outcome.existing,
        },
        { status: 409 }
      );
    }
    await syncCompanyDirectoryFromJobs([outcome.job]);
    return NextResponse.json(outcome.job, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
