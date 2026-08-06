// src/app/api/interviews/route.ts
// GET  -> paginated/filterable list of interviews with candidate + job info.
//         Base table is applications.status = 'interview' (not interview_schedules alone) --
//         most interview-stage applications were migrated/backfilled and never got a formal
//         schedule row, so anchoring on interview_schedules hid them entirely. Each row is
//         left-joined to its earliest interview_schedules row (if any) and flagged with
//         has_transcript so the UI can filter interviews that still need a real transcript.
// POST -> create an interview schedule with panel members

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { query, queryOne, execute } from "@/server/db/neon";

const TRANSCRIPT_MARKERS = ["%[Interview Transcript Logged]%", "%[Interview Recording Logged]%"];

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const status = url.searchParams.get("status") || "";
  const candidateId = url.searchParams.get("candidateId") || "";
  const jobId = url.searchParams.get("jobId") || "";
  const search = (url.searchParams.get("search") || "").trim();
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";
  const hasTranscript = url.searchParams.get("hasTranscript") || ""; // "yes" | "no" | ""

  const offset = (page - 1) * pageSize;

  const rowsCte = `
    WITH interview_rows AS (
      SELECT
        a.id AS application_id,
        s.id AS schedule_id,
        COALESCE(s.round_name, 'Not scheduled') AS round_name,
        COALESCE(s.round_number, 1) AS round_number,
        s.scheduled_at,
        s.duration_minutes,
        COALESCE(s.status, 'unscheduled') AS status,
        s.location,
        s.meeting_link,
        a.candidate_id,
        a.job_id,
        c.id AS c_id, c.name AS c_name, c.email AS c_email,
        j.id AS j_id, j.title AS j_title, j.company AS j_company,
        (
          EXISTS (
            SELECT 1 FROM application_comments ac
            WHERE ac.application_id = a.id
              AND (ac.body ILIKE '${TRANSCRIPT_MARKERS[0]}' OR ac.body ILIKE '${TRANSCRIPT_MARKERS[1]}')
          )
          OR (a.notes ILIKE '${TRANSCRIPT_MARKERS[0]}' OR a.notes ILIKE '${TRANSCRIPT_MARKERS[1]}')
        ) AS has_transcript
      FROM applications a
      LEFT JOIN LATERAL (
        SELECT * FROM interview_schedules s2
        WHERE s2.application_id = a.id
        ORDER BY s2.scheduled_at ASC NULLS LAST
        LIMIT 1
      ) s ON true
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE (a.status = 'interview' OR s.id IS NOT NULL)
    )
  `;

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
  if (candidateId) { conditions.push(`candidate_id = $${idx++}`); params.push(candidateId); }
  if (jobId) { conditions.push(`job_id = $${idx++}`); params.push(jobId); }
  if (dateFrom) { conditions.push(`scheduled_at >= $${idx++}`); params.push(dateFrom); }
  if (dateTo) { conditions.push(`scheduled_at <= $${idx++}`); params.push(`${dateTo}T23:59:59`); }
  if (search) {
    conditions.push(`(round_name ILIKE $${idx} OR c_name ILIKE $${idx} OR j_title ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  if (hasTranscript === "yes") conditions.push(`has_transcript = true`);
  if (hasTranscript === "no") conditions.push(`has_transcript = false`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await queryOne<{ count: string }>(
    `${rowsCte} SELECT COUNT(*) as count FROM interview_rows ${whereClause}`,
    params
  );
  const total = parseInt(countRow?.count ?? "0", 10);

  const rows = await query<any>(
    `${rowsCte} SELECT * FROM interview_rows ${whereClause} ORDER BY scheduled_at ASC NULLS LAST OFFSET $${idx++} LIMIT $${idx++}`,
    [...params, offset, pageSize]
  );

  // Fetch panel members for the scheduled rows only
  const scheduleIds = (rows ?? []).map((r: any) => r.schedule_id).filter(Boolean);
  let panelBySchedule = new Map<string, any[]>();
  if (scheduleIds.length > 0) {
    const schedPlaceholders = scheduleIds.map((_: string, i: number) => `$${i + 1}`).join(", ");
    const panels = await query(
      `SELECT * FROM interview_panel_members WHERE schedule_id::text IN (${schedPlaceholders})`,
      scheduleIds
    );
    const interviewerIds = (panels ?? []).map((p: any) => p.interviewer_id as string).filter(Boolean);
    let profiles: any[] = [];
    if (interviewerIds.length > 0) {
      const profPlaceholders = interviewerIds.map((_: string, i: number) => `$${i + 1}`).join(", ");
      profiles = await query(
        `SELECT user_id, display_name, email FROM profiles WHERE user_id::text IN (${profPlaceholders})`,
        interviewerIds
      );
    }
    const profileById = new Map(profiles.map((p: any) => [p.user_id as string, p]));
    const panelWithProfiles = (panels ?? []).map((pm: any) => ({
      ...pm,
      profile: profileById.get(pm.interviewer_id as string) ?? null,
    }));
    for (const pm of panelWithProfiles) {
      const list = panelBySchedule.get(pm.schedule_id as string) ?? [];
      list.push(pm);
      panelBySchedule.set(pm.schedule_id as string, list);
    }
  }

  const items = (rows ?? []).map((r: any) => ({
    id: r.schedule_id ?? `app-${r.application_id}`,
    schedule_id: r.schedule_id,
    application_id: r.application_id,
    round_name: r.round_name,
    round_number: r.round_number,
    scheduled_at: r.scheduled_at,
    duration_minutes: r.duration_minutes,
    status: r.status,
    location: r.location,
    meeting_link: r.meeting_link,
    has_transcript: r.has_transcript,
    applications: {
      candidate_id: r.candidate_id,
      job_id: r.job_id,
      candidates: r.c_id ? { id: r.c_id, name: r.c_name, email: r.c_email } : null,
      jobs: r.j_id ? { id: r.j_id, title: r.j_title, company: r.j_company } : null,
    },
    panel: r.schedule_id ? panelBySchedule.get(r.schedule_id) ?? [] : [],
  }));

  return NextResponse.json({ items, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.applicationId || !body.roundName || !body.scheduledAt) {
    return NextResponse.json(
      { error: "applicationId, roundName, and scheduledAt are required" },
      { status: 400 }
    );
  }

  const schedule = await queryOne(
    `INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, duration_minutes, location, meeting_link, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [body.applicationId, body.roundNumber ?? 1, body.roundName, body.scheduledAt, body.durationMinutes ?? 60, body.location ?? null, body.meetingLink ?? null, "scheduled", context.profile.user_id]
  );
  if (!schedule) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  // Insert panel members
  const panel = Array.isArray(body.panel) ? body.panel : [];
  if (panel.length > 0) {
    const cols = ["schedule_id", "interviewer_id", "role", "status"];
    const placeholders: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const p of panel) {
      const rowPlaceholders: string[] = [];
      for (const _ of cols) {
        rowPlaceholders.push(`$${idx++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(schedule.id, p.interviewerId, p.role ?? "interviewer", "pending");
    }
    try {
      await execute(
        `INSERT INTO interview_panel_members (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (err: any) {
      console.error("Panel insert error:", err.message);
    }
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "create",
    description: `Scheduled interview: ${body.roundName}`,
    entityType: "interview",
    entityId: schedule.id,
    entityName: body.roundName,
    metadata: {
      application_id: body.applicationId,
      round_name: body.roundName,
      scheduled_at: body.scheduledAt,
    },
  });

  return NextResponse.json(schedule, { status: 201 });
}
