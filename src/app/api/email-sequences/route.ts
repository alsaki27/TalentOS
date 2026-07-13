// src/app/api/email-sequences/route.ts
// GET  -> list sequences
// POST -> create sequence with steps
// PATCH -> update sequence
// DELETE -> delete sequence

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

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

  const sequence = await queryOne(
    `INSERT INTO email_sequences (name, description, trigger_event, is_active, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [body.name, body.description ?? null, body.trigger_event ?? null, body.is_active ?? true, context.profile.user_id]
  );
  if (!sequence) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

  const steps = body.steps ?? [];
  if (steps.length > 0) {
    const cols = ["sequence_id", "step_number", "template_id", "delay_hours", "send_time", "condition"];
    const placeholders: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const step of steps) {
      const rowPlaceholders: string[] = [];
      for (const _ of cols) {
        rowPlaceholders.push(`$${idx++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(
        sequence.id,
        step.step_number,
        step.template_id,
        step.delay_hours ?? 24,
        step.send_time ?? null,
        step.condition ?? null
      );
    }
    await execute(
      `INSERT INTO email_sequence_steps (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values
    );
  }

  return NextResponse.json({ ...sequence, steps }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data = await queryOne(
    `UPDATE email_sequences SET name = $1, description = $2, trigger_event = $3, is_active = $4 WHERE id = $5 RETURNING *`,
    [body.name ?? null, body.description ?? null, body.trigger_event ?? null, body.is_active ?? null, body.id]
  );
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  // Replace steps if provided
  if (body.steps && Array.isArray(body.steps)) {
    await execute("DELETE FROM email_sequence_steps WHERE sequence_id = $1", [body.id]);
    const cols = ["sequence_id", "step_number", "template_id", "delay_hours", "send_time", "condition"];
    const placeholders: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const step of body.steps) {
      const rowPlaceholders: string[] = [];
      for (const _ of cols) {
        rowPlaceholders.push(`$${idx++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(
        body.id,
        step.step_number,
        step.template_id,
        step.delay_hours ?? 24,
        step.send_time ?? null,
        step.condition ?? null
      );
    }
    await execute(
      `INSERT INTO email_sequence_steps (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values
    );
  }

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
