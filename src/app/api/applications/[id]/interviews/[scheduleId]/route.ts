// PATCH -> edit (or reschedule) one interview stage. Detecting a reschedule
// happens here, server-side, not from a client-sent flag: if scheduled_at
// changes from a previously-set value, rescheduled_at is stamped in the same
// update - the one source of truth TalentOS and the candidate portal both read.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { isInterviewTimeZone } from "@/lib/easternTime";
import { queryOne, sql } from "@/server/db/neon";
import { INTERVIEW_STAGE_COLUMNS_S, parsePreparationFields } from "@/server/services/interviewStageFields";
import { getApplicationInterviewAccess } from "@/server/services/applicationInterviewAccess";
import { APPLICATION_INTERVIEW_ACCESS_SQL } from "@/lib/applicationInterviewAccess";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; scheduleId: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const access = await getApplicationInterviewAccess(params.id);
  if (!access.exists) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Interview details unlock when the application reaches Interview." }, { status: 409 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid interview details." }, { status: 400 });
  }
  let preparation;
  try {
    preparation = parsePreparationFields(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const existing = await queryOne<{ scheduled_at: string | null; status: string | null; has_new_fields: boolean }>(
    `SELECT scheduled_at, status, to_jsonb(interview_schedules) ? 'mock_interview_taken' AS has_new_fields
     FROM interview_schedules WHERE id = $1 AND application_id = $2`,
    [params.scheduleId, params.id]
  );
  if (!existing) return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });

  const sets: string[] = [];
  const values: unknown[] = [];
  const hasDate = "scheduledAt" in body || "scheduled_at" in body;
  const scheduledAt = hasDate ? (body.scheduledAt ?? body.scheduled_at ?? null) : existing.scheduled_at;
  const effectiveStatus = preparation.status ?? existing.status;

  if ("mockInterviewTaken" in body) {
    if (typeof body.mockInterviewTaken !== "boolean") {
      return NextResponse.json({ error: "Choose Yes or No for the mock interview." }, { status: 400 });
    }
    if (!existing.has_new_fields) {
      return NextResponse.json({ error: "Saving mock interviews requires database migration 141." }, { status: 503 });
    }
    values.push(body.mockInterviewTaken);
    sets.push(`mock_interview_taken = $${values.length}`);
  }

  if (hasDate) {
    const validDate = typeof scheduledAt === "string" && !Number.isNaN(new Date(scheduledAt).getTime());
    const canClear = scheduledAt === null && (effectiveStatus === "planned" || effectiveStatus === "cancelled");
    if (!validDate && !canClear) return NextResponse.json({ error: "Enter a valid interview date." }, { status: 400 });
    values.push(scheduledAt);
    sets.push(`scheduled_at = $${values.length}`);
    if (existing.has_new_fields) {
      const newDate = `$${values.length}::timestamptz`;
      const reschedule = `scheduled_at IS NOT NULL AND ${newDate} IS NOT NULL AND scheduled_at <> ${newDate}`;
      sets.push(`previous_scheduled_at = CASE WHEN ${reschedule} THEN scheduled_at ELSE previous_scheduled_at END`);
      sets.push(`previous_time_zone = CASE WHEN ${reschedule} THEN time_zone ELSE previous_time_zone END`);
    }
    sets.push(`rescheduled_at = CASE WHEN scheduled_at IS NOT NULL
      AND $${values.length}::timestamptz IS NOT NULL AND scheduled_at <> $${values.length}::timestamptz THEN now()
      WHEN $${values.length}::timestamptz IS NULL THEN NULL ELSE rescheduled_at END`);
  } else if (preparation.status === "scheduled" && !scheduledAt) {
    return NextResponse.json({ error: "Enter a date before scheduling this interview." }, { status: 400 });
  }
  if ("timeZone" in body || "time_zone" in body) {
    const timeZone = body.timeZone ?? body.time_zone;
    if (!isInterviewTimeZone(timeZone)) return NextResponse.json({ error: "Invalid time zone." }, { status: 400 });
    values.push(timeZone);
    sets.push(`time_zone = $${values.length}`);
  }
  if ("format" in body) {
    if (body.format !== "online" && body.format !== "onsite") {
      return NextResponse.json({ error: "format must be \"online\" or \"onsite\"." }, { status: 400 });
    }
    values.push(body.format);
    sets.push(`interview_format = $${values.length}`);
  }
  if ("notes" in body) {
    values.push(typeof body.notes === "string" ? body.notes.trim() || null : null);
    sets.push(`notes = $${values.length}`);
  }
  for (const [column, value] of Object.entries(preparation)) {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "No fields to update." }, { status: 400 });

  const actor = currentUser.profile;
  const fieldCount = values.length;
  values.push(params.scheduleId, params.id, actor.user_id, actor.email, actor.display_name || actor.email,
    JSON.stringify(Object.keys(body)));
  const stage = await queryOne(
    `WITH previous AS (
       SELECT s.id, s.scheduled_at AS old_time, s.time_zone AS old_zone
       FROM interview_schedules s WHERE s.id = $${fieldCount + 1} AND s.application_id = $${fieldCount + 2}
       FOR UPDATE
     ), changed AS (
       UPDATE interview_schedules s SET ${sets.join(", ")}
       FROM applications a, previous p
       WHERE s.id = p.id AND s.application_id = $${fieldCount + 2}
         AND a.id = s.application_id AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
       RETURNING ${INTERVIEW_STAGE_COLUMNS_S}, p.old_time, p.old_zone,
         (p.old_time IS NOT NULL AND s.scheduled_at IS NOT NULL AND p.old_time <> s.scheduled_at) AS was_rescheduled
     ), audit AS (
       INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
       SELECT $${fieldCount + 3}, $${fieldCount + 4},
              CASE WHEN was_rescheduled THEN 'interview_stage.rescheduled' ELSE 'interview_stage.updated' END,
              'application', $${fieldCount + 2},
              jsonb_build_object('stage_id', id, 'round', round_number, 'status', status,
                'actor', $${fieldCount + 5}::text, 'fields', $${fieldCount + 6}::jsonb,
                'previous_scheduled_at', old_time, 'previous_time_zone', old_zone,
                'scheduled_at', scheduled_at, 'time_zone', time_zone,
                'mock_interview_taken', CASE WHEN $${fieldCount + 6}::jsonb ? 'mockInterviewTaken' THEN mock_interview_taken END)
       FROM changed
     )
     SELECT * FROM changed`,
    values
  );
  if (!stage) return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });
  const { old_time, old_zone, was_rescheduled, ...updatedStage } = stage;
  return NextResponse.json({ stage: updatedStage, rescheduled: was_rescheduled === true });
}

// Keep the surviving stage IDs so their attachments and feedback stay linked.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; scheduleId: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const access = await getApplicationInterviewAccess(params.id);
  if (!access.exists) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Interview details unlock when the application reaches Interview." }, { status: 409 });

  const [, deleted] = await sql().transaction((tx) => [
    // Use the same application lock as stage creation before reading the surviving rounds.
    tx.query(`SELECT a.id FROM applications a WHERE a.id = $1 AND ${APPLICATION_INTERVIEW_ACCESS_SQL} FOR UPDATE`, [params.id]),
    tx.query<{ id: string }[]>(
      `WITH deleted AS (
         DELETE FROM interview_schedules s USING applications a
         WHERE s.id = $1 AND s.application_id = $2 AND a.id = s.application_id
           AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
         RETURNING s.id
       ), numbered AS (
         SELECT s.id, ROW_NUMBER() OVER (
           ORDER BY s.round_number, s.created_at NULLS LAST, s.id
         )::integer AS new_round
         FROM interview_schedules s
         WHERE s.application_id = $2 AND s.id <> $1 AND EXISTS (SELECT 1 FROM deleted)
       ), renumbered AS (
         UPDATE interview_schedules s SET round_number = n.new_round
         FROM numbered n WHERE s.id = n.id AND s.round_number <> n.new_round
       )
       SELECT id FROM deleted`,
      [params.scheduleId, params.id]
    ),
  ]);
  if (!deleted.length) return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
