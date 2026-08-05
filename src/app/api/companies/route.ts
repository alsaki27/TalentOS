import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { query, queryOne } from "@/server/db/neon";

const SORT_COLUMNS: Record<string, string> = {
  name: "name",
  job_count: "job_count",
  people_count: "people_count",
  application_count: "application_count",
  interview_count: "interview_count",
  last_seen_at: "last_seen_at",
};

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim();
  const source = (url.searchParams.get("source") || "").trim();
  const minApplications = parseInt(url.searchParams.get("minApplications") || "", 10);
  const minJobs = parseInt(url.searchParams.get("minJobs") || "", 10);
  const sortKey = url.searchParams.get("sort") || "last_seen_at";
  const sortCol = SORT_COLUMNS[sortKey] || "last_seen_at";
  const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const from = (page - 1) * pageSize;

  const filterParams: unknown[] = [
    search ? `%${search}%` : null,
    source || null,
    Number.isFinite(minApplications) ? minApplications : null,
    Number.isFinite(minJobs) ? minJobs : null,
  ];
  const whereSql = `
    WHERE ($1::text IS NULL OR name ILIKE $1)
      AND ($2::text IS NULL OR source = $2)
      AND ($3::int IS NULL OR application_count >= $3)
      AND ($4::int IS NULL OR job_count >= $4)
  `;

  const statsCte = `
    WITH company_stats AS (
      SELECT
        c.id, c.name, c.website, c.linkedin_url, c.logo_url, c.employees_count,
        c.slogan, c.source, c.last_seen_at,
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id), 0)::int AS job_count,
        COALESCE((SELECT COUNT(*) FROM company_people cp WHERE cp.company_id = c.id), 0)::int AS people_count,
        COALESCE((SELECT COUNT(*) FROM jobs j JOIN applications a ON a.job_id = j.id WHERE j.company_id = c.id), 0)::int AS application_count,
        COALESCE((SELECT COUNT(*) FROM jobs j JOIN applications a ON a.job_id = j.id WHERE j.company_id = c.id AND a.status = 'interview'), 0)::int AS interview_count
      FROM companies c
    )
  `;

  let companies: any[] = [];
  let count = 0;
  let topByApplications: any[] = [];
  let bySource: any[] = [];
  let sources: string[] = [];

  try {
    const countRes = await queryOne<{ total: number }>(
      `${statsCte} SELECT COUNT(*)::int AS total FROM company_stats ${whereSql}`,
      filterParams
    );
    count = countRes?.total ?? 0;

    companies = await query(
      `${statsCte} SELECT * FROM company_stats ${whereSql} ORDER BY ${sortCol} ${order} NULLS LAST OFFSET $5 LIMIT $6`,
      [...filterParams, from, pageSize]
    );

    topByApplications = await query(
      `${statsCte} SELECT id, name, application_count FROM company_stats ${whereSql} AND application_count > 0
       ORDER BY application_count DESC LIMIT 10`,
      filterParams
    );

    bySource = await query(
      `${statsCte} SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count FROM company_stats ${whereSql}
       GROUP BY source ORDER BY count DESC`,
      filterParams
    );

    const sourceRows = await query<{ source: string | null }>(
      `SELECT DISTINCT source FROM companies WHERE source IS NOT NULL ORDER BY source`
    );
    sources = sourceRows.map((r) => r.source as string);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({
    companies,
    total: count,
    page,
    pageSize,
    sources,
    stats: { topByApplications, bySource },
  });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const normalizedName = normalizeCompanyName(name);

  let data: any;
  let error: any;

  try {
    data = await queryOne(
      `INSERT INTO companies (name, normalized_name, slug, website, linkedin_url, logo_url, employees_count, slogan, description, notes, source, updated_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (normalized_name) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         website = EXCLUDED.website,
         linkedin_url = EXCLUDED.linkedin_url,
         logo_url = EXCLUDED.logo_url,
         employees_count = EXCLUDED.employees_count,
         slogan = EXCLUDED.slogan,
         description = EXCLUDED.description,
         notes = EXCLUDED.notes,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at,
         last_seen_at = EXCLUDED.last_seen_at
       RETURNING *`,
      [
        name,
        normalizedName,
        normalizedName.replace(/\s+/g, "-"),
        body.website || null,
        body.linkedin_url || null,
        body.logo_url || null,
        body.employees_count || null,
        body.slogan || null,
        body.description || null,
        body.notes || null,
        body.source || "manual",
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    error = data ? null : { message: "Upsert failed" };
  } catch (err: any) {
    error = { message: err.message };
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
