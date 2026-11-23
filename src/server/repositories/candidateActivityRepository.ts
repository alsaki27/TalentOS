import { query } from "@/server/db/neon";
import { APPLICATION_INTERVIEW_ACCESS_SQL } from "@/lib/applicationInterviewAccess";
import { activityDate, type CandidateActivityItem } from "@/lib/candidateActivity";

/** One batch for the visible candidate cards; no per-card API or AI calls. */
export const CANDIDATE_UPCOMING_SQL = `WITH upcoming AS (
  SELECT a.candidate_id, 'interview:' || s.id AS id, 'interview' AS kind,
    COALESCE(s.round_name, 'Interview') AS title, s.scheduled_at AS at, false AS date_only,
    s.time_zone, s.status, a.id AS application_id, j.title AS job_title, j.company,
    s.meeting_link, s.location, s.round_number, NULL::text AS detail, NULL::timestamptz AS end_at
  FROM interview_schedules s JOIN applications a ON a.id = s.application_id LEFT JOIN jobs j ON j.id = a.job_id
  WHERE a.candidate_id = ANY($1::uuid[]) AND s.scheduled_at >= NOW()
    AND COALESCE(s.status, 'scheduled') IN ('planned','scheduled','in_progress')
    AND ${APPLICATION_INTERVIEW_ACCESS_SQL} AND a.status NOT IN ('rejected','withdrawn')
  UNION ALL
  SELECT a.candidate_id, 'follow-up:' || a.id, 'follow_up', a.next_action,
    a.follow_up_at::timestamp AT TIME ZONE 'UTC', true, NULL, 'pending', a.id, j.title, j.company,
    NULL, NULL, NULL, a.next_action, NULL::timestamptz
  FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
  WHERE a.candidate_id = ANY($1::uuid[]) AND a.follow_up_at >= CURRENT_DATE
    AND a.follow_up_completed_at IS NULL AND NULLIF(TRIM(a.next_action), '') IS NOT NULL
    AND NULLIF(a.follow_up_source, '') IS NOT NULL AND a.follow_up_source <> 'auto_status_rule'
    AND a.status IN ('applied','replied','screening','interview','offer')
    AND COALESCE(a.application_stage, '') NOT IN ('closed','on_hold')
  UNION ALL
  SELECT o.candidate_id, 'opt-window:' || o.id, 'opt', 'OPT 90-day window ends',
    (o.approval_date + 90)::timestamp AT TIME ZONE 'UTC', true, NULL, 'deadline', NULL, NULL, NULL,
    NULL, NULL, NULL, 'Based on the recorded OPT approval date: ' || o.approval_date::text, NULL::timestamptz
  FROM candidate_opt_status o JOIN candidates c ON c.id = o.candidate_id
  WHERE o.candidate_id = ANY($1::uuid[]) AND o.approval_date IS NOT NULL
    AND NOT COALESCE(o.approval_not_provided, false) AND o.approval_date + 90 >= CURRENT_DATE
    AND c.pipeline_stage NOT IN ('placed','dropped')
  UNION ALL
  SELECT x.candidate_id, 'custom:' || x.id, 'custom', x.title,
    COALESCE(x.starts_at,x.start_date::timestamp AT TIME ZONE 'UTC'), x.schedule_mode <> 'time_range',
    x.time_zone, CASE WHEN x.schedule_mode='time_range' THEN CASE WHEN x.starts_at <= now() THEN 'in_progress' ELSE 'upcoming' END
      ELSE CASE WHEN x.start_date <= (now() AT TIME ZONE x.time_zone)::date THEN 'in_progress' ELSE 'upcoming' END END,
    NULL,NULL,NULL,x.link,NULL,NULL,x.body,COALESCE(x.ends_at,x.end_date::timestamp AT TIME ZONE 'UTC')
  FROM candidate_custom_activities x WHERE x.candidate_id=ANY($1::uuid[]) AND x.deleted_at IS NULL
    AND ((x.schedule_mode='time_range' AND x.ends_at >= now()) OR
      (x.schedule_mode IN ('date','date_range') AND COALESCE(x.end_date,x.start_date) >= (now() AT TIME ZONE x.time_zone)::date))
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY at, id) AS rank FROM upcoming
) SELECT * FROM ranked WHERE rank <= $2 ORDER BY candidate_id, at, id`;

export interface UpcomingRow {
  candidate_id: string; id: string; kind: "interview" | "follow_up" | "opt" | "custom"; title: string;
  at: string; date_only: boolean; time_zone: string | null; status: string | null;
  application_id: string | null; job_title: string | null; company: string | null;
  meeting_link: string | null; location: string | null; round_number: number | null; detail: string | null;
  end_at: string | null;
}
export async function candidateUpcoming(ids: string[], limit: number): Promise<Map<string, CandidateActivityItem[]>> {
  const result = new Map<string, CandidateActivityItem[]>(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const rows = await query<UpcomingRow>(CANDIDATE_UPCOMING_SQL, [ids, limit]);
  for (const row of rows) {
    const rawDate = activityDate(row.at);
    const at = row.date_only ? rawDate?.slice(0, 10) : rawDate;
    if (!at) continue;
    const href = row.application_id ? `/candidates/${row.candidate_id}/applications/${row.application_id}` :
      row.kind === "custom" ? `/candidates/${row.candidate_id}/activity` : `/candidates/${row.candidate_id}?tab=OPT%20Status`;
    result.get(row.candidate_id)?.push({
      id: row.id, candidateId: row.candidate_id, type: row.kind, title: row.title,
      summary: row.kind === "custom" ? row.detail || "" : [row.job_title, row.company].filter(Boolean).join(" · "), at,
      endAt: row.end_at ? (row.date_only ? activityDate(row.end_at)?.slice(0, 10) : activityDate(row.end_at)) : null,
      dateOnly: row.date_only, timeZone: row.time_zone, status: row.status,
      details: [row.round_number != null && { label: "Stage", value: String(row.round_number) },
        row.location && { label: "Location", value: row.location }, row.detail && { label: "Details", value: row.detail }]
        .filter(Boolean) as CandidateActivityItem["details"],
      links: [{ label: row.application_id ? "Open application" : "Open OPT status", href },
        ...(row.meeting_link ? [{ label: row.kind === "custom" ? "Open link" : "Open meeting", href: row.meeting_link }] : [])],
    });
  }
  return result;
}

export const ACTIVITY_INTERVIEWS_SQL = `SELECT s.*, a.candidate_id, a.id AS application_id, j.title AS job_title, j.company,
  EXISTS(SELECT 1 FROM audit_logs l WHERE l.entity_type='application' AND l.entity_id=a.id
    AND ((l.action='interview_stage.added' AND l.metadata->>'stage_id'=s.id::text)
      OR (l.action='application.interview_scheduled' AND l.metadata->>'id'=s.id::text))) AS logged_creation,
  EXISTS(SELECT 1 FROM audit_logs l WHERE l.entity_type='application' AND l.entity_id=a.id
    AND l.action='interview_stage.rescheduled' AND l.metadata->>'stage_id'=s.id::text) AS logged_reschedule
  FROM interview_schedules s JOIN applications a ON a.id=s.application_id LEFT JOIN jobs j ON j.id=a.job_id
  WHERE a.candidate_id=$1 AND ${APPLICATION_INTERVIEW_ACCESS_SQL}`;
export const ACTIVITY_AUDIT_SQL = `SELECT l.id, l.action, l.created_at, l.actor_email, l.metadata,
  a.id AS application_id, j.title AS job_title, j.company, j.source_url AS job_url,
  CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
    'round_number', s.round_number, 'round_name', s.round_name, 'scheduled_at', s.scheduled_at,
    'time_zone', s.time_zone, 'status', s.status, 'interview_format', s.interview_format,
    'duration_minutes', s.duration_minutes, 'location', s.location, 'meeting_link', s.meeting_link,
    'preparation_notes', s.preparation_notes, 'notes', s.notes, 'mock_interview_taken', s.mock_interview_taken
  ) END AS current_stage
  FROM audit_logs l JOIN applications a ON l.entity_type='application' AND l.entity_id=a.id
  LEFT JOIN jobs j ON j.id=a.job_id
  LEFT JOIN interview_schedules s ON s.application_id=a.id
    AND s.id::text=COALESCE(NULLIF(l.metadata->>'stage_id',''),l.metadata->>'id')
  WHERE a.candidate_id=$1 AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
  AND (l.action IN ('interview_stage.added','interview_stage.updated','interview_stage.rescheduled','interview_stage.cancelled',
    'interview_stage.deleted','application.interview_scheduled','custom_interview.created','custom_interview.updated')
    OR l.action IN ('interview_audio.added','interview_audio.removed','interview_audio.replaced',
      'interview_file.added','interview_file.removed','interview_file.replaced'))`;
export const ACTIVITY_NOTES_SQL = `SELECT n.* FROM student_audit_sticky_notes n
  JOIN student_audit_links l ON l.audit_student_id=n.student_id WHERE l.candidate_id=$1
  AND NULLIF(TRIM(n.content),'') IS NOT NULL
  AND NOT (n.id LIKE 'note-mock-%' AND EXISTS(SELECT 1 FROM student_audit_mock_sessions m WHERE m.student_id=n.student_id AND m.session_date=n.date))`;
export const ACTIVITY_MOCKS_SQL = `SELECT m.id, m.session_date, m.target_role, m.round_type, m.feedback_summary,
  m.strengths_noted, m.areas_for_improvement, m.overall_score, m.overall_score_max, m.created_by, m.created_at, m.updated_at,
  NULLIF(TRIM(m.transcript_raw_text),'') IS NOT NULL AS has_transcript, m.transcript_source, m.pdf_filename
  FROM student_audit_mock_sessions m JOIN student_audit_links l ON l.audit_student_id=m.student_id WHERE l.candidate_id=$1`;
export const ACTIVITY_TRAINING_SQL = `SELECT s.progress, s.rating, s.synced_at FROM student_audit_students s
  JOIN student_audit_links l ON l.audit_student_id=s.id WHERE l.candidate_id=$1`;
export const ACTIVITY_OPT_SQL = `SELECT id, created_at, updated_at, approval_date::text, uscis_current_status,
  ead_work_authorization_type, notes FROM candidate_opt_status WHERE candidate_id=$1`;
export const ACTIVITY_LOGS_SQL = `SELECT id,type,description,metadata,actor_name,created_at,entity_type FROM activity_logs
  WHERE entity_id=$1::text AND (entity_type='candidate_opt_status'
    OR (entity_type='candidate' AND (metadata->'fields') ?| ARRAY['pipeline_stage','status'])
    OR entity_type='candidate_training')`;
export const ACTIVITY_CUSTOM_SQL = `SELECT x.*,x.start_date::text,x.end_date::text,p.display_name AS actor_name
  FROM candidate_custom_activities x LEFT JOIN profiles p ON p.user_id=x.updated_by
  WHERE x.candidate_id=$1 AND x.deleted_at IS NULL`;
