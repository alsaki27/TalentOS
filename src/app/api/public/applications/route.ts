import { NextRequest, NextResponse } from "next/server";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { createApplicationEvent } from "@/server/repositories/applicationsRepository";

const APPLICATION_FIELDS = [
  "candidate_id", "job_id", "status", "resume_url", "resume_filename", "resume_id",
  "follow_up_at", "next_action", "notes", "assigned_by", "assigned_to",
  "assigned_by_user_id", "assigned_to_user_id", "assignment_note", "assignment_due_at",
  "priority", "review_status", "review_note",
];

function isAssignmentPayload(body: any) {
  return ["assigned", "stacked", "in_progress"].includes(body.status) || Boolean(body.assigned_to || body.assigned_to_user_id);
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 150 });
  const status = url.searchParams.get("status") || "";
  const candidateId = url.searchParams.get("candidate_id") || "";
  const jobId = url.searchParams.get("job_id") || "";
  const assignedToUserId = url.searchParams.get("assigned_to_user_id") || "";
  const priority = url.searchParams.get("priority") || "";

  if (isNeon()) {
    const offset = from;
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`a.status = $${idx++}`);
      values.push(status);
    }
    if (candidateId) {
      conditions.push(`a.candidate_id = $${idx++}`);
      values.push(candidateId);
    }
    if (jobId) {
      conditions.push(`a.job_id = $${idx++}`);
      values.push(jobId);
    }
    if (assignedToUserId) {
      conditions.push(`a.assigned_to_user_id = $${idx++}`);
      values.push(assignedToUserId);
    }
    if (priority) {
      conditions.push(`a.priority = $${idx++}`);
      values.push(priority);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int as total FROM applications a ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, [...values]);
    const total = countRow?.total ?? 0;

    const dataSql = `
      SELECT a.*,
        jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email) as candidates,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location) as jobs
      FROM applications a
      LEFT JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN jobs j ON j.id = a.job_id
      ${where}
      ORDER BY a.applied_at DESC
      OFFSET $${idx++} LIMIT $${idx++}
    `;
    values.push(offset, pageSize);

    const data = await query<any>(dataSql, values);
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    let query = supabase
      .from("applications")
      .select("*, candidates(id, name, email), jobs(id, title, company, location)", { count: "planned" })
      .order("applied_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (candidateId) query = query.eq("candidate_id", candidateId);
    if (jobId) query = query.eq("job_id", jobId);
    if (assignedToUserId) query = query.eq("assigned_to_user_id", assignedToUserId);
    if (priority) query = query.eq("priority", priority);

    const { data, error, count } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "applications:write");
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id || !body.job_id) {
    return NextResponse.json({ error: "candidate_id and job_id are required" }, { status: 400 });
  }
  if (isAssignmentPayload(body)) {
    const assignmentAuth = await requirePublicApiScope(req, "applications:assign");
    if (assignmentAuth.response) return assignmentAuth.response;
  }

  const status = body.status ?? "applied";
  const automated = applicationAutomation({
    status,
    explicitFollowUp: "follow_up_at" in body,
    explicitNextAction: "next_action" in body,
    explicitAssignmentDue: "assignment_due_at" in body,
  });

  const row: any = {
    ...pickFields(body, APPLICATION_FIELDS),
    status,
    follow_up_at: "follow_up_at" in body ? body.follow_up_at : automated.follow_up_at ?? null,
    next_action: "next_action" in body ? body.next_action : automated.next_action ?? null,
    assignment_due_at: "assignment_due_at" in body ? body.assignment_due_at : automated.assignment_due_at ?? null,
    follow_up_source: "follow_up_at" in body ? (body.follow_up_at ? "manual" : null) : automated.follow_up_source ?? null,
    follow_up_created_at: automated.follow_up_created_at ?? null,
    follow_up_completed_at: null,
    priority: body.priority ?? "normal",
    review_status: body.review_status ?? "not_required",
  };

  if (isNeon()) {
    // Check for duplicate candidate+job combination
    if (row.candidate_id && row.job_id) {
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM applications WHERE candidate_id = $1 AND job_id = $2 LIMIT 1`,
        [row.candidate_id, row.job_id]
      );
      if (existing) {
        return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
      }
    }
    try {
      const sanitizedRow: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value !== undefined) sanitizedRow[key] = value;
      }
      const cols = Object.keys(sanitizedRow);
      const values = Object.values(sanitizedRow);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO applications (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const data = await queryOne<any>(sql, values);
      if (!data) throw new Error("Insert failed");
      await createApplicationEvent({
        application_id: data.id,
        from_status: null,
        to_status: status,
        note: body.event_note ?? body.assignment_note ?? null,
      });
      return NextResponse.json(data, { status: 201 });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } else {
    const { data, error } = await supabase.from("applications").insert(row).select().single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("application_events").insert({
      application_id: data.id,
      from_status: null,
      to_status: status,
      note: body.event_note ?? body.assignment_note ?? null,
    });

    return NextResponse.json(data, { status: 201 });
  }
}
