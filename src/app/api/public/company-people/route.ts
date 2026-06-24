import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const companyId = url.searchParams.get("company_id") || "";
  const search = (url.searchParams.get("search") || "").trim();

  if (isNeon()) {
    const offset = from;
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (companyId) {
      conditions.push(`company_id = $${idx++}`);
      values.push(companyId);
    }
    if (search) {
      conditions.push(`(full_name ILIKE $${idx++} OR title ILIKE $${idx++} OR email ILIKE $${idx++})`);
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int as total FROM company_people ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, [...values]);
    const total = countRow?.total ?? 0;

    const dataSql = `SELECT cp.*, jsonb_build_object('id', c.id, 'name', c.name) as companies FROM company_people cp LEFT JOIN companies c ON cp.company_id = c.id ${where} ORDER BY last_seen_at DESC OFFSET $${idx++} LIMIT $${idx++}`;
    values.push(offset, pageSize);

    const data = await query(dataSql, values);
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("company_people")
      .select("*, companies(id, name)", { count: "planned" })
      .order("last_seen_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (search) query = query.or(`full_name.ilike.%${search}%,title.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, error, count } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "company_people:write");
  if (response) return response;

  const body = await req.json();
  const fullName = String(body.full_name ?? "").trim();
  if (!fullName || !body.company_id) return NextResponse.json({ error: "company_id and full_name are required" }, { status: 400 });

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO company_people (company_id, full_name, normalized_name, title, linkedin_url, photo_url, email, phone, influence_level, relationship_status, notes, source, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        body.company_id,
        fullName,
        normalizeCompanyName(fullName),
        body.title || null,
        body.linkedin_url || null,
        body.photo_url || null,
        body.email || null,
        body.phone || null,
        body.influence_level || "unknown",
        body.relationship_status || "new",
        body.notes || null,
        body.source || "public_api",
        new Date().toISOString(),
      ]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("company_people")
      .insert({
        company_id: body.company_id,
        full_name: fullName,
        normalized_name: normalizeCompanyName(fullName),
        title: body.title || null,
        linkedin_url: body.linkedin_url || null,
        photo_url: body.photo_url || null,
        email: body.email || null,
        phone: body.phone || null,
        influence_level: body.influence_level || "unknown",
        relationship_status: body.relationship_status || "new",
        notes: body.notes || null,
        source: body.source || "public_api",
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
