// GET  -> list every interview stage (round) for an application
// POST -> add the next round or fill one of the four legacy round slots
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { EASTERN_TIME_ZONE, isInterviewTimeZone } from "@/lib/easternTime";
import { query, sql } from "@/server/db/neon";
import { INTERVIEW_STAGE_COLUMNS, INTERVIEW_STAGE_COLUMNS_S, parsePreparationFields } from "@/server/services/interviewStageFields";
import { getApplicationInterviewAccess } from "@/server/services/applicationInterviewAccess";
import { APPLICATION_INTERVIEW_ACCESS_SQL } from "@/lib/applicationInterviewAccess";

// Not exported: a route.ts file in the App Router may only export the HTTP
// method handlers and a small fixed set of special names (dynamic, config,
// ...) - any other export fails Next's generated route-shape typecheck.
const MAX_INTERVIEW_STAGES = 4;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const access = await getApplicationInterviewAccess(params.id);
  if (!access.exists) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Interview details unlock when the application reaches Interview." }, { status: 409 });

  const stages = await query(
    `SELECT ${INTERVIEW_STAGE_COLUMNS_S} FROM interview_schedules s
     WHERE s.application_id = $1 AND EXISTS (
       SELECT 1 FROM applications a WHERE a.id = s.application_id AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
     )
     ORDER BY s.round_number ASC, s.created_at ASC`,
    [params.id]
  );
  return NextResponse.json({ stages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const access = await getApplicationInterviewAccess(params.id);
  if (!access.exists) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Interview details unlock when the application reaches Interview." }, { status: 409 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid interview details." }, { status: 400 });
  }
  const requestedRound = body.roundNumber ?? body.round_number;
  const roundNumber = requestedRound == null ? null : Number(requestedRound);
  const scheduledAt = body.scheduledAt;
  const format = body.format;
  const timeZone = body.timeZone ?? body.time_zone ?? EASTERN_TIME_ZONE;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  let preparation;
  try {
    preparation = parsePreparationFields(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (roundNumber !== null && (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > MAX_INTERVIEW_STAGES)) {
    return NextResponse.json({ error: `Stage must be a whole number from 1 to ${MAX_INTERVIEW_STAGES}.` }, { status: 400 });
  }
  const validDate = typeof scheduledAt === "string" && !Number.isNaN(new Date(scheduledAt).getTime());
  const validFormat = format === "online" || format === "onsite";
  const status = preparation.status ?? "scheduled";
  const hasNoDate = scheduledAt == null && (status === "planned" || status === "cancelled");
  if ((!validDate && !hasNoDate) || !validFormat || !isInterviewTimeZone(timeZone)) {
    return NextResponse.json({ error: "scheduledAt, timeZone, and format must be valid." }, { status: 400 });
  }

  const actor = currentUser.profile;
  const db = sql();
  // Serialize additions for this application before reading its current rounds.
  const [applications, stages] = await db.transaction((tx) => [
      tx.query(`SELECT id FROM applications a WHERE a.id = $1 AND ${APPLICATION_INTERVIEW_ACCESS_SQL} FOR UPDATE`, [params.id]),
    tx.query(
      `WITH added AS (
         INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, time_zone,
           interview_format, notes, created_by, status, location, meeting_link, preparation_notes, duration_minutes)
         SELECT a.id, COALESCE($2::int, (SELECT MAX(round_number) + 1 FROM interview_schedules WHERE application_id = a.id), 1),
           $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
         FROM applications a WHERE a.id = $1 AND ${APPLICATION_INTERVIEW_ACCESS_SQL} AND NOT EXISTS (
           SELECT 1 FROM interview_schedules WHERE application_id = a.id AND round_number = $2::int
         )
         RETURNING ${INTERVIEW_STAGE_COLUMNS}
       ), audit AS (
         INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
         SELECT $14, $15, 'interview_stage.added', 'application', $1,
                jsonb_build_object('stage_id', id, 'round', round_number, 'status', status, 'actor', $8::text)
         FROM added
       )
       SELECT * FROM added`,
      [params.id, roundNumber, preparation.round_name ?? "Interview", scheduledAt ?? null, timeZone, format, notes,
        actor.display_name || actor.email || "TalentOS staff", status, preparation.location ?? null, preparation.meeting_link ?? null,
        preparation.preparation_notes ?? null, preparation.duration_minutes ?? 60, actor.user_id, actor.email]
    ),
  ]);
  if (!applications.length) {
    const accessAfterLock = await getApplicationInterviewAccess(params.id);
    if (!accessAfterLock.exists) return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (!accessAfterLock.allowed) return NextResponse.json({ error: "Interview details unlock when the application reaches Interview." }, { status: 409 });
    return NextResponse.json({ error: "Application could not be locked for an interview update." }, { status: 409 });
  }
  if (!stages.length) return NextResponse.json({ error: `Stage ${roundNumber} already exists.` }, { status: 409 });
  return NextResponse.json({ stage: stages[0] }, { status: 201 });
}
