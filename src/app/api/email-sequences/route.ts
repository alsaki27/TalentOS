import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, sql } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SequenceStepInput {
  step_number: number;
  template_id: string;
  delay_hours: number;
  send_time: string | null;
  condition: string | null;
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function optionalText(body: Record<string, any>, field: string): { value?: string | null; error?: string } {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return {};
  const value = body[field];
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${field} must be a string or null.` };
  return { value };
}

function parseSteps(value: unknown): { steps?: SequenceStepInput[]; error?: string } {
  if (!Array.isArray(value)) return { error: "steps must be an array." };
  if (value.length > 100) return { error: "A sequence cannot contain more than 100 steps." };

  const seen = new Set<number>();
  const steps: SequenceStepInput[] = [];
  for (const rawStep of value) {
    const step = asObject(rawStep);
    if (!step || !Number.isSafeInteger(step.step_number) || step.step_number < 1) {
      return { error: "Every step needs a positive integer step_number." };
    }
    if (seen.has(step.step_number)) return { error: "step_number values must be unique." };
    seen.add(step.step_number);
    if (typeof step.template_id !== "string" || !UUID_PATTERN.test(step.template_id)) {
      return { error: "Every step needs a valid template_id." };
    }
    const delayHours = step.delay_hours === undefined ? 24 : step.delay_hours;
    if (!Number.isSafeInteger(delayHours) || delayHours < 0) {
      return { error: "delay_hours must be a non-negative integer." };
    }
    if (step.send_time !== undefined && step.send_time !== null && typeof step.send_time !== "string") {
      return { error: "send_time must be a string or null." };
    }
    if (step.condition !== undefined && step.condition !== null && typeof step.condition !== "string") {
      return { error: "condition must be a string or null." };
    }
    steps.push({
      step_number: step.step_number,
      template_id: step.template_id,
      delay_hours: delayHours,
      send_time: step.send_time ?? null,
      condition: step.condition ?? null,
    });
  }
  return { steps };
}

async function templatesExist(steps: SequenceStepInput[]) {
  const ids = [...new Set(steps.map((step) => step.template_id))];
  if (!ids.length) return true;
  const templates = await query<{ id: string }>(
    "SELECT id FROM email_templates WHERE id = ANY($1::uuid[])",
    [ids],
  );
  const found = new Set(templates.map((template) => template.id.toLowerCase()));
  return ids.every((id) => found.has(id.toLowerCase()));
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const offset = (page - 1) * pageSize;
  const params: any[] = [];
  let idx = 1;
  const whereClause = search
    ? (params.push(`%${search}%`), `WHERE (name ILIKE $${idx} OR description ILIKE $${idx++})`)
    : "";

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM email_sequences ${whereClause}`,
    params,
  );
  const total = parseInt(countRow?.count ?? "0", 10);
  const data = await query(
    `SELECT e.*,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id', s.id, 'sequence_id', s.sequence_id, 'step_number', s.step_number,
         'template_id', s.template_id, 'delay_hours', s.delay_hours,
         'send_time', s.send_time, 'condition', s.condition,
         'template', CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name, 'subject', t.subject) END
       ) ORDER BY s.step_number)
       FROM email_sequence_steps s LEFT JOIN email_templates t ON s.template_id = t.id
       WHERE s.sequence_id = e.id), '[]'::jsonb) as steps
     FROM email_sequences e ${whereClause}
     ORDER BY e.created_at DESC OFFSET $${idx++} LIMIT $${idx}`,
    [...params, offset, pageSize],
  );

  return NextResponse.json({ items: data ?? [], total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = asObject(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
    return NextResponse.json({ error: "description must be a string or null." }, { status: 400 });
  }
  if (body.trigger_event !== undefined && body.trigger_event !== null && typeof body.trigger_event !== "string") {
    return NextResponse.json({ error: "trigger_event must be a string or null." }, { status: 400 });
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active must be a boolean." }, { status: 400 });
  }

  const parsed = parseSteps(body.steps ?? []);
  if (!parsed.steps) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await templatesExist(parsed.steps))) {
    return NextResponse.json({ error: "One or more selected email templates do not exist." }, { status: 400 });
  }

  try {
    // One statement makes the parent and all child steps an atomic write.
    const sequence = await queryOne(
      `WITH new_sequence AS (
         INSERT INTO email_sequences (name, description, trigger_event, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *
       ), inserted_steps AS (
         INSERT INTO email_sequence_steps (sequence_id, step_number, template_id, delay_hours, send_time, condition)
         SELECT s.id, step.step_number, step.template_id, step.delay_hours, step.send_time, step.condition
           FROM new_sequence s
           CROSS JOIN LATERAL jsonb_to_recordset($6::jsonb) AS step(
             step_number integer, template_id uuid, delay_hours integer, send_time text, condition text
           )
         RETURNING id
       )
       SELECT * FROM new_sequence`,
      [name, body.description ?? null, body.trigger_event ?? null, body.is_active ?? true, context.profile.user_id, JSON.stringify(parsed.steps)],
    );
    if (!sequence) return NextResponse.json({ error: "Could not create sequence." }, { status: 500 });
    return NextResponse.json({ ...sequence, steps: parsed.steps }, { status: 201 });
  } catch (error) {
    console.error("[email-sequences] Create failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not create sequence and steps." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = asObject(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return NextResponse.json({ error: "A valid id is required." }, { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(body, "name") && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "name must be a non-empty string." }, { status: 400 });
  }
  const description = optionalText(body, "description");
  const triggerEvent = optionalText(body, "trigger_event");
  if (description.error || triggerEvent.error) {
    return NextResponse.json({ error: description.error ?? triggerEvent.error }, { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_active") && typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active must be a boolean." }, { status: 400 });
  }

  const replaceSteps = Object.prototype.hasOwnProperty.call(body, "steps");
  const parsed = replaceSteps ? parseSteps(body.steps) : { steps: [] as SequenceStepInput[] };
  if (!parsed.steps) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await templatesExist(parsed.steps))) {
    return NextResponse.json({ error: "One or more selected email templates do not exist." }, { status: 400 });
  }

  try {
    const results = await sql().transaction((tx) => {
      const statements = [
        tx`UPDATE email_sequences
              SET name = CASE WHEN ${Object.prototype.hasOwnProperty.call(body, "name")} THEN ${body.name ?? null} ELSE name END,
                  description = CASE WHEN ${Object.prototype.hasOwnProperty.call(body, "description")} THEN ${description.value ?? null} ELSE description END,
                  trigger_event = CASE WHEN ${Object.prototype.hasOwnProperty.call(body, "trigger_event")} THEN ${triggerEvent.value ?? null} ELSE trigger_event END,
                  is_active = CASE WHEN ${Object.prototype.hasOwnProperty.call(body, "is_active")} THEN ${body.is_active ?? null} ELSE is_active END
            WHERE id = ${body.id}
            RETURNING *`,
      ];
      if (replaceSteps) {
        statements.push(tx`DELETE FROM email_sequence_steps WHERE sequence_id = ${body.id}` as any);
        if (parsed.steps!.length) {
          statements.push(tx`INSERT INTO email_sequence_steps (sequence_id, step_number, template_id, delay_hours, send_time, condition)
            SELECT ${body.id}, step.step_number, step.template_id, step.delay_hours, step.send_time, step.condition
              FROM jsonb_to_recordset(${JSON.stringify(parsed.steps)}::jsonb) AS step(
                step_number integer, template_id uuid, delay_hours integer, send_time text, condition text
              )
             WHERE EXISTS (SELECT 1 FROM email_sequences WHERE id = ${body.id})` as any);
        }
      }
      return statements;
    });

    const updated = (results[0] as any[])[0];
    if (!updated) return NextResponse.json({ error: "Sequence not found." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[email-sequences] Update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not update sequence and steps." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await sql().query("DELETE FROM email_sequences WHERE id = $1", [id]);
  return NextResponse.json({ success: true });
}
