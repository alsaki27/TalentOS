// PATCH -> edit (or reschedule) one interview stage. Detecting a reschedule
// happens here, server-side, not from a client-sent flag: if scheduled_at
// changes from a previously-set value, rescheduled_at is stamped in the same
// update - the one source of truth TalentOS and the candidate portal both read.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { isInterviewTimeZone } from "@/lib/easternTime";
import { queryOne } from "@/server/db/neon";

const STAGE_COLUMNS = `id, round_number, round_name, scheduled_at, time_zone, duration_minutes, status,
       interview_format, location, meeting_link, notes, rescheduled_at, created_at`;

export async function PATCH(req: NextRequest, { params }: { params: { id: string; scheduleId: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const existing = await queryOne<{ scheduled_at: string | null }>(
    `SELECT scheduled_at FROM interview_schedules WHERE id = $1 AND application_id = $2`,
    [params.scheduleId, params.id]
  );
  if (!existing) return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });

  const sets: string[] = [];
  const values: unknown[] = [];
  let rescheduled = false;

  if ("scheduledAt" in body || "scheduled_at" in body) {
    const scheduledAt = body.scheduledAt ?? body.scheduled_at;
    if (typeof scheduledAt !== "string" || Number.isNaN(new Date(scheduledAt).getTime())) {
      return NextResponse.json({ error: "scheduledAt must be a valid date." }, { status: 400 });
    }
    if (existing.scheduled_at && new Date(existing.scheduled_at).getTime() !== new Date(scheduledAt).getTime()) {
      rescheduled = true;
    }
    values.push(scheduledAt);
    sets.push(`scheduled_at = $${values.length}`);
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
  if ("status" in body) {
    values.push(String(body.status));
    sets.push(`status = $${values.length}`);
  }
  if (rescheduled) sets.push(`rescheduled_at = now()`);
  if (sets.length === 0) return NextResponse.json({ error: "No fields to update." }, { status: 400 });

  values.push(params.scheduleId, params.id);
  const stage = await queryOne(
    `UPDATE interview_schedules SET ${sets.join(", ")}
     WHERE id = $${values.length - 1} AND application_id = $${values.length}
     RETURNING ${STAGE_COLUMNS}`,
    values
  );
  return NextResponse.json({ stage, rescheduled });
}
