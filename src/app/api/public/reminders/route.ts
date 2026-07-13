import { NextRequest, NextResponse } from "next/server";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "reminders:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const due = url.searchParams.get("due") || "";
  const today = new Date().toISOString().slice(0, 10);

  const offset = from;
  const conditions: string[] = ["follow_up_at IS NOT NULL"];
  const values: any[] = [];
  let idx = 1;

  if (due === "today") {
    conditions.push(`follow_up_at <= $${idx++}`);
    values.push(today);
  }
  if (due === "upcoming") {
    conditions.push(`follow_up_at > $${idx++}`);
    values.push(today);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const countSql = `SELECT COUNT(*)::int as total FROM applications ${where}`;
  const countRow = await queryOne<{ total: number }>(countSql, [...values]);
  const total = countRow?.total ?? 0;

  const dataSql = `
    SELECT a.id, a.status, a.follow_up_at, a.follow_up_source, a.follow_up_created_at, a.follow_up_completed_at, a.next_action, a.assigned_to, a.assigned_to_user_id,
      jsonb_build_object('id', c.id, 'name', c.name) as candidates,
      jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company) as jobs
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    ${where}
    ORDER BY a.follow_up_at ASC
    OFFSET $${idx++} LIMIT $${idx++}
  `;
  values.push(offset, pageSize);

  const data = await query(dataSql, values);
  return NextResponse.json({ data: data ?? [], total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "reminders:write");
  if (response) return response;

  const body = await req.json();
  if (!body.application_id || !body.follow_up_at) {
    return NextResponse.json({ error: "application_id and follow_up_at are required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  data = await queryOne(
    `UPDATE applications SET follow_up_at = $1, next_action = $2, follow_up_source = $3, follow_up_created_at = $4, follow_up_completed_at = $5 WHERE id = $6 RETURNING *`,
    [body.follow_up_at, body.next_action || null, body.follow_up_source || "public_api", new Date().toISOString(), null, body.application_id]
  );
  error = data ? null : { message: "Update failed" };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
