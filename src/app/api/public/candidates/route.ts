import { NextRequest, NextResponse } from "next/server";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { query, queryOne } from "@/server/db/neon";
import { isMissingPostgresColumn } from "@/server/db/schemaCompatibility";

const CANDIDATE_FIELDS = [
  "name", "email", "phone", "status", "target_tier", "notes", "resume_url",
  "resume_filename", "target_roles", "preferred_locations", "salary_expectation",
  "work_authorization", "avatar_url", "has_contract",
];

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const targetTier = url.searchParams.get("target_tier") || "";

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
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:write");
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (body.has_contract !== undefined && typeof body.has_contract !== "boolean") {
    return NextResponse.json({ error: "has_contract must be true or false when provided" }, { status: 400 });
  }

  const payload = {
    ...pickFields(body, CANDIDATE_FIELDS),
    status: body.status ?? "active",
    // Existing integrations predate this field. Preserve their behavior using
    // the requested legacy-candidate default until they send an explicit value.
    has_contract: body.has_contract ?? true,
  };

  let data: any;
  let error: any;

  const keys = Object.keys(payload);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const values = keys.map((k) => (payload as any)[k]);
  try {
    data = await queryOne(
      `INSERT INTO candidates (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
  } catch (insertError) {
    if (!isMissingPostgresColumn(insertError, "has_contract")) throw insertError;
    if (payload.has_contract === false) {
      return NextResponse.json({ error: "The candidate contract database update is required before creating a candidate marked No. No candidate was created." }, { status: 503 });
    }
    const legacyKeys = keys.filter((key) => key !== "has_contract");
    const legacyPlaceholders = legacyKeys.map((_, i) => `$${i + 1}`).join(", ");
    const legacyValues = legacyKeys.map((key) => (payload as any)[key]);
    data = await queryOne(
      `INSERT INTO candidates (${legacyKeys.join(", ")}) VALUES (${legacyPlaceholders}) RETURNING *`,
      legacyValues
    );
    if (data) data.has_contract = true;
  }
  error = data ? null : { message: "Insert failed" };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
