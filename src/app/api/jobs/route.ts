// src/app/api/jobs/route.ts
// GET  -> paginated/filterable masterlist of jobs, each with applicant count + names
// POST -> manually add one job

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

// Excludes description_html/raw_source_payload/benefits/company_address — large
// HTML/JSON blobs only needed on the job detail page, not the list view. At 1,000+
// rows including them ballooned the list payload to 24MB on every page load.
const LIST_COLUMNS = `
  id, company_id, title, company, location, source, role_tier, salary_range, source_url, notes,
  is_active, seniority_level, employment_type, applicants_count, company_employees_count,
  company_website, posted_at, external_job_id, tracking_id, ref_id, apply_url,
  job_function, industries, input_url, company_linkedin_url,
  company_logo_url, company_slogan, job_poster_name, job_poster_title,
  job_poster_profile_url, job_poster_photo_url, job_category, category_tags,
  category_relevance_score, category_status, ai_suggested_category,
  salary_min, salary_max, salary_currency, salary_period,
  work_authorization, work_authorization_evidence, last_seen_at, created_at,
  applications(id, status, candidates(id, name, avatar_url))
`;

const JOB_COLUMNS = `
  id, company_id, title, company, location, source, role_tier, salary_range, source_url, notes,
  is_active, seniority_level, employment_type, applicants_count, company_employees_count,
  company_website, posted_at, external_job_id, tracking_id, ref_id, apply_url,
  job_function, industries, input_url, company_linkedin_url,
  company_logo_url, company_slogan, job_poster_name, job_poster_title,
  job_poster_profile_url, job_poster_photo_url, job_category, category_tags,
  category_relevance_score, category_status, ai_suggested_category,
  salary_min, salary_max, salary_currency, salary_period,
  work_authorization, work_authorization_evidence, last_seen_at, created_at
`;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const source = url.searchParams.get("source") || "";
  const roleTier = url.searchParams.get("roleTier") || "";
  const active = url.searchParams.get("active") || "";
  const employmentType = url.searchParams.get("employmentType") || "";
  const category = url.searchParams.get("category") || "";
  const workAuthorization = url.searchParams.get("workAuthorization") || "";
  const dateStart = url.searchParams.get("dateStart") || "";
  const dateEnd = url.searchParams.get("dateEnd") || "";
  const scoreStr = url.searchParams.get("score") || "";
  const candidate = url.searchParams.get("candidate") || "";
  const assignedBy = url.searchParams.get("assignedBy") || "";
  const owner = url.searchParams.get("owner") || "";
  const sort = url.searchParams.get("sort") || "";

  let scoreMin = -1;
  let scoreMax = 101;
  if (scoreStr) {
    const [minStr, maxStr] = scoreStr.split(",");
    scoreMin = parseInt(minStr, 10);
    scoreMax = parseInt(maxStr, 10);
    if (isNaN(scoreMin)) scoreMin = 0;
    if (isNaN(scoreMax)) scoreMax = 100;
  }

  const offset = (page - 1) * pageSize;
  const searchParam = `%${search}%`;

  const dataSql = `
    SELECT ${JOB_COLUMNS},
      COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'status', a.status,
            'candidates', jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url)
          )
        ) FROM applications a LEFT JOIN candidates c ON a.candidate_id = c.id WHERE a.job_id = j.id),
        '[]'::jsonb
      ) as applications
    FROM jobs j
    WHERE ($1 = '' OR j.title ILIKE $1 OR j.company ILIKE $1 OR j.location ILIKE $1)
      AND ($2 = '' OR j.source = $2)
      AND ($3 = '' OR j.role_tier = $3)
      AND ($4 = '' OR j.is_active = ($4 = 'active'))
      AND ($5 = '' OR j.employment_type = $5)
      AND ($6 = '' OR j.job_category ILIKE '%' || $6 || '%' OR array_to_string(j.category_tags, ',') ILIKE '%' || $6 || '%')
      AND ($7 = '' OR j.work_authorization = $7)
      AND ($8 = '' OR j.posted_at >= $8::timestamp)
      AND ($9 = '' OR j.posted_at <= $9::timestamp)
      AND ($10 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.candidate_id::text = $10))
      AND ($11 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND (a.assigned_by_user_id::text = $11 OR a.assigned_by = $11)))
      AND ($12 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND (a.assigned_to_user_id::text = $12 OR a.assigned_to = $12)))
      AND ($13 = -1 OR (j.category_relevance_score >= $13::int AND j.category_relevance_score <= $14::int))
      AND j.created_at >= '2026-07-10'
    ORDER BY
      CASE WHEN $15 = 'posted_asc' THEN j.posted_at END ASC NULLS LAST,
      CASE WHEN $15 = 'posted_desc' THEN j.posted_at END DESC NULLS LAST,
      CASE WHEN $15 <> 'posted_asc' AND $15 <> 'posted_desc' THEN j.created_at END DESC NULLS LAST
    OFFSET $16 LIMIT $17
  `;

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM jobs j
    WHERE ($1 = '' OR j.title ILIKE $1 OR j.company ILIKE $1 OR j.location ILIKE $1)
      AND ($2 = '' OR j.source = $2)
      AND ($3 = '' OR j.role_tier = $3)
      AND ($4 = '' OR j.is_active = ($4 = 'active'))
      AND ($5 = '' OR j.employment_type = $5)
      AND ($6 = '' OR j.job_category ILIKE '%' || $6 || '%' OR array_to_string(j.category_tags, ',') ILIKE '%' || $6 || '%')
      AND ($7 = '' OR j.work_authorization = $7)
      AND ($8 = '' OR j.posted_at >= $8::timestamp)
      AND ($9 = '' OR j.posted_at <= $9::timestamp)
      AND ($10 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.candidate_id::text = $10))
      AND ($11 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND (a.assigned_by_user_id::text = $11 OR a.assigned_by = $11)))
      AND ($12 = '' OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND (a.assigned_to_user_id::text = $12 OR a.assigned_to = $12)))
      AND ($13 = -1 OR (j.category_relevance_score >= $13::int AND j.category_relevance_score <= $14::int))
      AND j.created_at >= '2026-07-10'
  `;

  try {
    const jobs = await query<Record<string, any>>(dataSql, [
      searchParam, source, roleTier, active, employmentType, category, workAuthorization,
      dateStart, dateEnd, candidate, assignedBy, owner, scoreMin, scoreMax, sort, offset, pageSize,
    ]);
    const countRow = await queryOne<{ total: number }>(countSql, [
      searchParam, source, roleTier, active, employmentType, category, workAuthorization,
      dateStart, dateEnd, candidate, assignedBy, owner, scoreMin, scoreMax,
    ]);

    const shaped = (jobs ?? []).map((job: any) => ({
      ...job,
      applicant_count: job.applications?.length ?? 0,
      applicants: (job.applications ?? []).map((a: any) => ({
        application_id: a.id,
        candidate_id: a.candidates?.id,
        name: a.candidates?.name,
        avatar_url: a.candidates?.avatar_url,
        status: a.status,
      })),
    }));

    const jobIds = shaped.map((j: any) => j.id);
    let matchScores: any[] = [];
    if (jobIds.length > 0) {
      const placeholders = jobIds.map((_, i) => `$${i + 1}`).join(",");
      const scores = await query<Record<string, any>>(`
        SELECT ms.job_id, ms.score, ms.breakdown, c.id as candidate_id, c.name as candidate_name 
        FROM job_match_scores ms
        LEFT JOIN candidates c ON ms.candidate_id = c.id
        WHERE ms.job_id IN (${placeholders})
      `, jobIds);
      matchScores = scores || [];
    }

    const shapedWithScores = shaped.map((job: any) => ({
      ...job,
      match_scores: matchScores.filter((ms) => 
        ms.job_id === job.id && 
        job.applicants.some((a: any) => a.candidate_id === ms.candidate_id)
      ),
    }));

    return NextResponse.json({ jobs: shapedWithScores, total: countRow?.total ?? 0, page, pageSize });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const applicantsCount = body.applicants_count !== undefined && body.applicants_count !== null && body.applicants_count !== ""
    ? parseInt(String(body.applicants_count).replace(/[^\d]/g, ""), 10)
    : null;
  const row = {
    title: body.title,
    company: body.company ?? null,
    location: body.location ?? null,
    source: "manual",
    role_tier: body.role_tier ?? null,
    salary_range: body.salary_range ?? null,
    source_url: body.source_url ?? null,
    notes: body.notes ?? null,
    description_text: body.description_text ?? null,
    posted_at: body.posted_at || null,
    applicants_count: Number.isFinite(applicantsCount) ? applicantsCount : null,
    // job_category intentionally omitted — category_status defaults to 'pending' at
    // the DB level and the AI categorization pass fills it in afterward.
  };

  const { newRows } = await filterNewJobs([row]);
  if (newRows.length === 0) {
    return NextResponse.json(
      { error: "Duplicate job: same posting URL or same title, company, posted date, and applicant count." },
      { status: 409 }
    );
  }

  try {
    const cols = Object.keys(row);
    const values = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
    const data = await queryOne<Record<string, any>>(sql, values);
    if (!data) throw new Error("Insert failed");
    await syncCompanyDirectoryFromJobs([data]);

    if (context && data) {
      await logActivity({
        userId: context.profile.user_id,
        actorName: context.profile.display_name || context.profile.email || undefined,
        type: "create",
        description: `Created job ${data.title}`,
        entityType: "job",
        entityId: data.id,
        entityName: data.title,
        metadata: { company: data.company },
      });
      void triggerWebhooks("job.created", {
        job_id: data.id,
        title: data.title,
        company: data.company,
        created_by: context.profile.user_id,
      });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
