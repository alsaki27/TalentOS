// GET  -> list every interview stage (round) for an application
// POST -> schedule a new stage (round 1-4 not already taken)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { EASTERN_TIME_ZONE, isInterviewTimeZone } from "@/lib/easternTime";
import { query, queryOne } from "@/server/db/neon";

// Not exported: a route.ts file in the App Router may only export the HTTP
// method handlers and a small fixed set of special names (dynamic, config,
// ...) - any other export fails Next's generated route-shape typecheck.
const MAX_INTERVIEW_STAGES = 4;

const STAGE_COLUMNS = `id, round_number, round_name, scheduled_at, time_zone, duration_minutes, status,
       interview_format, location, meeting_link, notes, rescheduled_at, created_at`;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const stages = await query(
    `SELECT ${STAGE_COLUMNS} FROM interview_schedules WHERE application_id = $1 ORDER BY round_number ASC`,
    [params.id]
  );
  return NextResponse.json({ stages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const roundNumber = Number(body.roundNumber ?? body.round_number);
  const scheduledAt = body.scheduledAt;
  const format = body.format;
  const timeZone = body.timeZone ?? body.time_zone ?? EASTERN_TIME_ZONE;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > MAX_INTERVIEW_STAGES) {
    return NextResponse.json({ error: `Stage must be a whole number from 1 to ${MAX_INTERVIEW_STAGES}.` }, { status: 400 });
  }
  const validDate = typeof scheduledAt === "string" && !Number.isNaN(new Date(scheduledAt).getTime());
  const validFormat = format === "online" || format === "onsite";
  if (!validDate || !validFormat || !isInterviewTimeZone(timeZone)) {
    return NextResponse.json({ error: "scheduledAt, timeZone, and format must be valid." }, { status: 400 });
  }

  const existing = await queryOne(
    `SELECT id FROM interview_schedules WHERE application_id = $1 AND round_number = $2`,
    [params.id, roundNumber]
  );
  if (existing) {
    return NextResponse.json(
      { error: `Stage ${roundNumber} is already scheduled. Edit that stage instead of creating a new one.` },
      { status: 409 }
    );
  }

  const stage = await queryOne(
    `INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, time_zone, interview_format, notes, created_by)
     VALUES ($1, $2, 'Interview', $3, $4, $5, $6, $7)
     RETURNING ${STAGE_COLUMNS}`,
    [params.id, roundNumber, scheduledAt, timeZone, format, notes, currentUser.profile.display_name || currentUser.profile.email]
  );
  return NextResponse.json({ stage }, { status: 201 });
}
