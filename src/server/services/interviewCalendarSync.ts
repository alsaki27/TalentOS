import { sql } from "@/server/db/neon";
import { isInterviewTimeZone } from "@/lib/easternTime";
import { safeMeetingUrl } from "@/lib/applicationInterviewPreparation";
import type { InterviewCalendarInvite } from "@/lib/integrations/interviewCalendarInvite";

interface InterviewEmailSchedule {
  applicationId: string;
  emailId: string;
  sentAt: string;
  invite: InterviewCalendarInvite | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timeZone: string | null;
  location: string | null;
  meetingLink: string | null;
  rescheduleHint: boolean;
  cancelled: boolean;
}

export async function syncInterviewEmail(input: InterviewEmailSchedule) {
  const { invite, applicationId, scheduledAt, cancelled } = input;
  if (cancelled ? !invite : !scheduledAt) return;
  // A plain email announcing a new time cannot identify which stage to move.
  if (!invite && input.rescheduleHint) return;

  await sql().transaction((tx) => [
    tx.query("SELECT id FROM applications WHERE id = $1 FOR UPDATE", [applicationId]),
    tx.query(
      `WITH matches AS (
         SELECT s.* FROM interview_schedules s
         WHERE s.application_id = $1 AND (
           ($2::text IS NOT NULL AND s.calendar_event_key = $2) OR
           (NOT $10::boolean AND s.scheduled_at = $3::timestamptz AND
             ($2::text IS NULL OR (s.calendar_event_key IS NULL
               AND s.status IS DISTINCT FROM 'cancelled' AND s.status IS DISTINCT FROM 'completed'))))
       ), target AS (
         SELECT m.* FROM matches m
         WHERE m.calendar_event_key = $2 OR (m.calendar_event_key IS NULL AND (SELECT count(*) FROM matches) = 1)
         ORDER BY (m.calendar_event_key IS NOT NULL) DESC LIMIT 1
       ), updated AS (
         UPDATE interview_schedules s SET
           scheduled_at = CASE WHEN $10::boolean THEN s.scheduled_at ELSE $3::timestamptz END,
           previous_scheduled_at = CASE WHEN NOT $10::boolean AND s.scheduled_at IS NOT NULL
             AND s.scheduled_at <> $3::timestamptz THEN s.scheduled_at ELSE s.previous_scheduled_at END,
           previous_time_zone = CASE WHEN NOT $10::boolean AND s.scheduled_at IS NOT NULL
             AND s.scheduled_at <> $3::timestamptz THEN s.time_zone ELSE s.previous_time_zone END,
           rescheduled_at = CASE WHEN NOT $10::boolean AND s.scheduled_at IS NOT NULL
             AND s.scheduled_at <> $3::timestamptz THEN now() ELSE s.rescheduled_at END,
           time_zone = COALESCE($4, s.time_zone),
           duration_minutes = COALESCE($5, s.duration_minutes),
           location = COALESCE($6, s.location),
           meeting_link = COALESCE($7, s.meeting_link),
           status = CASE WHEN $10::boolean THEN 'cancelled' ELSE 'scheduled' END,
           calendar_event_key = $2, calendar_sequence = $8, calendar_version_at = $9
         FROM target t
         WHERE s.id = t.id AND s.status IS DISTINCT FROM 'completed' AND s.status IS DISTINCT FROM 'no_show'
           AND ($2::text IS NULL OR s.calendar_sequence IS NULL OR s.calendar_sequence < $8
             OR (s.calendar_sequence = $8 AND s.calendar_version_at < $9))
         RETURNING s.id, s.round_number, s.status, s.scheduled_at, s.time_zone,
           t.scheduled_at AS old_time, t.time_zone AS old_zone, t.status AS old_status
       ), added AS (
         INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, time_zone,
           duration_minutes, location, meeting_link, status, created_by, calendar_event_key, calendar_sequence, calendar_version_at)
         SELECT a.id, COALESCE((SELECT max(s.round_number) FROM interview_schedules s WHERE s.application_id = a.id), 0) + 1,
           'Email-detected interview', $3, COALESCE($4, 'America/New_York'),
           COALESCE($5, 60), $6, $7, 'scheduled', 'email-ai', $2, $8, $9
         FROM applications a
         WHERE a.id = $1 AND NOT $10::boolean AND NOT EXISTS (SELECT 1 FROM matches)
           AND (NOT $11::boolean OR NOT EXISTS (
             SELECT 1 FROM interview_schedules s WHERE s.application_id = a.id AND s.calendar_event_key IS NULL
               AND COALESCE(s.status, 'scheduled') IN ('planned', 'scheduled', 'in_progress')
           ))
         RETURNING id, round_number, status
       )
       INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
       SELECT CASE WHEN u.status = 'cancelled' THEN 'interview_stage.cancelled'
                   ELSE 'interview_stage.rescheduled' END, 'application', $1,
         jsonb_build_object('stage_id', u.id, 'round', u.round_number, 'status', u.status, 'actor', 'Gmail sync',
           'source_email_id', $12::uuid, 'previous_scheduled_at', u.old_time, 'previous_time_zone', u.old_zone,
           'scheduled_at', u.scheduled_at, 'time_zone', u.time_zone)
       FROM updated u
       WHERE (u.status = 'cancelled' AND u.old_status IS DISTINCT FROM u.status)
         OR (u.status = 'scheduled' AND u.old_time IS NOT NULL AND u.old_time <> u.scheduled_at)
       UNION ALL
       SELECT 'interview_stage.added', 'application', $1, jsonb_build_object(
         'stage_id', id, 'round', round_number, 'status', status, 'actor', 'Gmail sync', 'source_email_id', $12::uuid)
       FROM added`,
      [
        applicationId, invite?.key ?? null, scheduledAt,
        isInterviewTimeZone(input.timeZone) ? input.timeZone : null,
        input.durationMinutes, input.location, safeMeetingUrl(input.meetingLink),
        invite?.sequence ?? null, invite ? invite.versionAt ?? input.sentAt : null, cancelled,
        input.rescheduleHint || (invite?.sequence ?? 0) > 0, input.emailId,
      ],
    ),
  ]);
}
