import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

const COMPANY_FIELDS = [
  "name", "website", "linkedin_url", "logo_url", "employees_count",
  "address", "slogan", "description", "notes", "source",
];

function companyPayload(body: any) {
  const payload = pickFields(body, COMPANY_FIELDS);
  if (typeof payload.name === "string" && payload.name.trim()) {
    const name = payload.name.trim();
    const normalizedName = normalizeCompanyName(name);
    payload.name = name;
    payload.normalized_name = normalizedName;
    payload.slug = normalizedName.replace(/\s+/g, "-");
  }
  payload.updated_at = new Date().toISOString();
  payload.last_seen_at = body.last_seen_at || new Date().toISOString();
  return payload;
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "companies:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const search = (url.searchParams.get("search") || "").trim();

  if (isNeon()) {
    const offset = from;
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`name ILIKE $${idx++}`);
      values.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int as total FROM companies ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, [...values]);
    const total = countRow?.total ?? 0;

    const dataSql = `SELECT id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, created_at FROM companies ${where} ORDER BY last_seen_at DESC OFFSET $${idx++} LIMIT $${idx++}`;
    values.push(offset, pageSize);

    const data = await query(dataSql, values);
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("companies")
      .select("id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, created_at", { count: "planned" })
      .order("last_seen_at", { ascending: false });

    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error, count } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "companies:write");
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const payload = companyPayload(body);
  const keys = Object.keys(payload);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const values = keys.map((k) => (payload as any)[k]);

  let data: any;
  let error: any;

  if (isNeon()) {
    const updateClause = keys
      .filter((k) => k !== "normalized_name")
      .map((k) => `${k} = EXCLUDED.${k}`)
      .join(", ");
    data = await queryOne(
      `INSERT INTO companies (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT (normalized_name) DO UPDATE SET ${updateClause} RETURNING *`,
      values
    );
    error = data ? null : { message: "Upsert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("companies")
      .upsert(payload, { onConflict: "normalized_name" })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
