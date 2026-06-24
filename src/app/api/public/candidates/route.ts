import { NextRequest, NextResponse } from "next/server";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

const CANDIDATE_FIELDS = [
  "name", "email", "phone", "status", "target_tier", "notes", "resume_url",
  "resume_filename", "target_roles", "preferred_locations", "salary_expectation",
  "work_authorization", "avatar_url",
];

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const targetTier = url.searchParams.get("target_tier") || "";

  if (isNeon()) {
    const offset = from;
    const searchParam = `%${search}%`;
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(name ILIKE $${idx++} OR email ILIKE $${idx++} OR target_roles ILIKE $${idx++})`);
      values.push(searchParam, searchParam, searchParam);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }
    if (targetTier) {
      conditions.push(`target_tier = $${idx++}`);
      values.push(targetTier);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int as total FROM candidates ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, [...values]);
    const total = countRow?.total ?? 0;

    const dataSql = `SELECT id, name, email, phone, status, target_tier, target_roles, preferred_locations, salary_expectation, work_authorization, resume_url, resume_filename, avatar_url, created_at FROM candidates ${where} ORDER BY created_at DESC OFFSET $${idx++} LIMIT $${idx++}`;
    values.push(offset, pageSize);

    const data = await query(dataSql, values);
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("candidates")
      .select("id, name, email, phone, status, target_tier, target_roles, preferred_locations, salary_expectation, work_authorization, resume_url, resume_filename, avatar_url, created_at", { count: "planned" })
      .order("created_at", { ascending: false });

    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,target_roles.ilike.%${search}%`);
    if (status) query = query.eq("status", status);
    if (targetTier) query = query.eq("target_tier", targetTier);

    const { data, error, count } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:write");
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const payload = {
    ...pickFields(body, CANDIDATE_FIELDS),
    status: body.status ?? "active",
  };

  let data: any;
  let error: any;

  if (isNeon()) {
    const keys = Object.keys(payload);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map((k) => (payload as any)[k]);
    data = await queryOne(
      `INSERT INTO candidates (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("candidates")
      .insert(payload)
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
