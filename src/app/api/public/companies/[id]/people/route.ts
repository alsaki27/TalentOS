import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const { page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });

  if (isNeon()) {
    const offset = from;
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM company_people WHERE company_id = $1`,
      [params.id]
    );
    const total = countRow?.total ?? 0;

    const data = await query(
      `SELECT * FROM company_people WHERE company_id = $1 ORDER BY last_seen_at DESC OFFSET $2 LIMIT $3`,
      [params.id, offset, pageSize]
    );
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error, count } = await supabase
      .from("company_people")
      .select("*", { count: "planned" })
      .eq("company_id", params.id)
      .order("last_seen_at", { ascending: false })
      .range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:write");
  if (response) return response;

  const body = await req.json();
  const fullName = String(body.full_name ?? "").trim();
  if (!fullName) return NextResponse.json({ error: "full_name is required" }, { status: 400 });

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO company_people (company_id, full_name, normalized_name, title, linkedin_url, photo_url, email, phone, influence_level, relationship_status, notes, source, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        params.id,
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
        company_id: params.id,
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
