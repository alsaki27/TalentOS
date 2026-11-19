// src/app/api/email-sequences/route.ts
// GET  -> list sequences
// POST -> create sequence with steps
// PATCH -> update sequence
// DELETE -> delete sequence

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute, sql } from "@/server/db/neon";

export const dynamic = "force-dynamic";

type SequenceStepInput = {
  step_number: number;
  template_id: string;
  delay_hours?: number;
  send_time?: string | null;
  condition?: string | null;
};

function validSteps(value: unknown): value is SequenceStepInput[] {
  return Array.isArray(value) && value.length <= 50 && value.every((step) =>
    step && typeof step === "object" &&
    Number.isInteger(step.step_number) && step.step_number > 0 &&
    typeof step.template_id === "string" && step.template_id.length > 0 &&
    (step.delay_hours === undefined || (Number.isInteger(step.delay_hours) && step.delay_hours >= 0))
  );
}

function stepInsert(sequenceId: string, steps: SequenceStepInput[]) {
  const values: unknown[] = [];
  const placeholders = steps.map((step) => {
    const start = values.length + 1;
    values.push(sequenceId, step.step_number, step.template_id, step.delay_hours ?? 24,
      step.send_time ?? null, step.condition ?? null);
    return `(${Array.from({ length: 6 }, (_, offset) => `$${start + offset}`).join(", ")})`;
  });
  return {
    text: `INSERT INTO email_sequence_steps (sequence_id, step_number, template_id, delay_hours, send_time, condition) VALUES ${placeholders.join(", ")}`,
    values,
  };
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (search) {
    conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countSql = `SELECT COUNT(*) as count FROM email_sequences ${whereClause}`;
  const countRow = await queryOne<{ count: string }>(countSql, params);
  const total = parseInt(countRow?.count ?? "0", 10);

  const dataSql = `
    SELECT e.*,
      COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'sequence_id', s.sequence_id,
            'step_number', s.step_number,
            'template_id', s.template_id,
            'delay_hours', s.delay_hours,
            'send_time', s.send_time,
            'condition', s.condition,
            'template', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name, 'subject', t.subject) END
          ) ORDER BY s.step_number
        ) FROM email_sequence_steps s LEFT JOIN email_templates t ON s.template_id = t.id WHERE s.sequence_id = e.id),
        '[]'::jsonb
      ) as steps
    FROM email_sequences e
    ${whereClause}
    ORDER BY e.created_at DESC
    OFFSET $${idx++} LIMIT $${idx++}
  `;
  const data = await query(dataSql, [...params, offset, pageSize]);

  return NextResponse.json({ items: data ?? [], total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const steps: unknown = body.steps ?? [];
  if (!validSteps(steps)) return NextResponse.json({ error: "Invalid sequence steps" }, { status: 400 });

  const sequenceId = crypto.randomUUID();
  const [createdRows] = await sql().transaction((tx) => {
    const statements = [tx.query(
      `INSERT INTO email_sequences (id, name, description, trigger_event, is_active, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sequenceId, body.name, body.description ?? null, body.trigger_event ?? null, body.is_active ?? true, context.profile.user_id]
    )];
    if (steps.length > 0) {
      const insert = stepInsert(sequenceId, steps);
      statements.push(tx.query(insert.text, insert.values));
    }
    return statements;
  });
  const sequence = createdRows?.[0];
  if (!sequence) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

  return NextResponse.json({ ...sequence, steps }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "name must be a nonempty string" }, { status: 400 });
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active must be a boolean" }, { status: 400 });
  }
  if (body.steps !== undefined && !validSteps(body.steps)) {
    return NextResponse.json({ error: "Invalid sequence steps" }, { status: 400 });
  }

  const [updatedRows] = await sql().transaction((tx) => {
    const statements = [tx.query(
      `UPDATE email_sequences
          SET name = COALESCE($1, name),
              description = CASE WHEN $2::boolean THEN $3 ELSE description END,
              trigger_event = CASE WHEN $4::boolean THEN $5 ELSE trigger_event END,
              is_active = COALESCE($6, is_active)
        WHERE id = $7 RETURNING *`,
      [body.name ?? null, body.description !== undefined, body.description ?? null,
        body.trigger_event !== undefined, body.trigger_event ?? null, body.is_active ?? null, body.id]
    )];

    if (body.steps !== undefined) {
      statements.push(tx.query("DELETE FROM email_sequence_steps WHERE sequence_id = $1", [body.id]));
      if (body.steps.length > 0) {
        const insert = stepInsert(body.id, body.steps);
        statements.push(tx.query(insert.text, insert.values));
      }
    }
    return statements;
  });
  const data = updatedRows?.[0];
  if (!data) return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await execute("DELETE FROM email_sequences WHERE id = $1", [id]);
  return NextResponse.json({ success: true });
}
