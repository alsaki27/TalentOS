import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const from = (page - 1) * pageSize;

  let data: any;
  let error: any;
  let count: number | null = null;

  if (isNeon()) {
    try {
      const searchParam = search ? `%${search}%` : null;
      const countSql = search
        ? `SELECT COUNT(*)::int as total FROM companies WHERE name ILIKE $1`
        : `SELECT COUNT(*)::int as total FROM companies`;
      const countRes = await queryOne<{ total: number }>(countSql, search ? [searchParam] : []);
      count = countRes?.total ?? 0;

      const dataSql = search
        ? `SELECT id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id)) FROM jobs j WHERE j.company_id = companies.id), '[]'::jsonb) as jobs,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cp.id)) FROM company_people cp WHERE cp.company_id = companies.id), '[]'::jsonb) as company_people
          FROM companies WHERE name ILIKE $1 ORDER BY last_seen_at DESC OFFSET $2 LIMIT $3`
        : `SELECT id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id)) FROM jobs j WHERE j.company_id = companies.id), '[]'::jsonb) as jobs,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cp.id)) FROM company_people cp WHERE cp.company_id = companies.id), '[]'::jsonb) as company_people
          FROM companies ORDER BY last_seen_at DESC OFFSET $1 LIMIT $2`;
      data = await query(dataSql, search ? [searchParam, from, pageSize] : [from, pageSize]);
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("companies")
      .select("id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, jobs(id), company_people(id)", { count: "planned" })
      .order("last_seen_at", { ascending: false });

    if (search) query = query.ilike("name", `%${search}%`);

    const res = await query.range(from, from + pageSize - 1);
    data = res.data;
    error = res.error;
    count = res.count;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    companies: (data ?? []).map((company: any) => ({
      ...company,
      job_count: company.jobs?.length ?? 0,
      people_count: company.company_people?.length ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize,
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

  if (isNeon()) {
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
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("companies")
      .upsert({
        name,
        normalized_name: normalizedName,
        slug: normalizedName.replace(/\s+/g, "-"),
        website: body.website || null,
        linkedin_url: body.linkedin_url || null,
        logo_url: body.logo_url || null,
        employees_count: body.employees_count || null,
        slogan: body.slogan || null,
        description: body.description || null,
        notes: body.notes || null,
        source: body.source || "manual",
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "normalized_name" })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
