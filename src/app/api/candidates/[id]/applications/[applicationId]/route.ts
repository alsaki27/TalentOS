import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import type { ApplicationActivity, ApplicationDetailData, ApplicationDetailRecord } from "@/lib/candidateApplicationDetail";
import type { ApplicationInterviewStage } from "@/lib/applicationInterviewPreparation";
import { query, queryOne } from "@/server/db/neon";
import { INTERVIEW_STAGE_COLUMNS } from "@/server/services/interviewStageFields";
import { listInterviewPreparationFiles, UUID_PATTERN } from "@/server/services/interviewPreparationFiles";
import { canAccessInterviewDetails } from "@/lib/applicationInterviewAccess";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string; applicationId: string } }) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const { id: candidateId, applicationId } = params;
  if (![candidateId, applicationId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  try {
    const application = await queryOne<ApplicationDetailRecord>(
      `SELECT a.id, a.app_number, a.status, a.application_stage, a.ae_stage, a.source_type,
           a.created_at, a.applied_at, a.next_action, a.follow_up_at, a.notes, a.tailored_resume_version_id,
           COALESCE(a.resume_url, r.file_url) AS resume_url, COALESCE(a.resume_filename, r.filename) AS resume_filename,
           a.job_id, c.name AS candidate_name, c.timezone AS candidate_timezone,
           j.title AS job_title, j.company AS company_name, j.company_website, j.location, j.source AS job_source,
           tj.fit_score, tj.recommendation, j.eligibility_restricted, j.requires_citizenship, j.citizenship_countries,
           j.export_control_restricted, j.eligibility_restriction_evidence,
           COALESCE(j.apply_url, j.source_url) AS source_url, archive.storage_url AS sharepoint_resume_url
       FROM applications a JOIN candidates c ON c.id = a.candidate_id LEFT JOIN jobs j ON j.id = a.job_id
       LEFT JOIN resumes r ON r.id = a.resume_id AND r.candidate_id = a.candidate_id
       LEFT JOIN target_jobs tj ON tj.job_id = a.job_id AND tj.candidate_id = a.candidate_id
       LEFT JOIN LATERAL (
         SELECT e.storage_url FROM application_resume_exports e
         WHERE e.application_id = a.id AND e.resume_version_id = a.tailored_resume_version_id
           AND e.export_type = 'pdf' AND e.status = 'created' AND e.storage_url IS NOT NULL
         ORDER BY COALESCE(e.updated_at, e.created_at) DESC LIMIT 1
       ) archive ON true WHERE a.id = $1 AND a.candidate_id = $2`,
      [applicationId, candidateId]
    );
    if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });
    const canShowInterviewDetails = canAccessInterviewDetails(application.status, application.application_stage, application.ae_stage);

    const [stages, files, activity] = await Promise.all([
      canShowInterviewDetails ? query<ApplicationInterviewStage>(
        `SELECT ${INTERVIEW_STAGE_COLUMNS} FROM interview_schedules
         WHERE application_id = $1
         ORDER BY COALESCE(scheduled_at, created_at) DESC NULLS LAST, round_number DESC, id`,
        [applicationId]
      ) : Promise.resolve([]),
      canShowInterviewDetails ? listInterviewPreparationFiles(applicationId) : Promise.resolve([]),
      query<ApplicationActivity>(
        `SELECT * FROM (
           SELECT id::text, 'stage' AS kind, 'Application stage changed' AS action,
             from_stage AS before_value, to_stage AS after_value, reason AS detail, changed_by_name AS actor, changed_at AS created_at,
             NULL::text AS previous_time_zone, NULL::text AS time_zone
           FROM application_stage_history WHERE application_id = $1
           UNION ALL
           SELECT id::text, 'status', 'Application status changed', from_status, to_status, note, NULL, created_at, NULL, NULL
           FROM application_events WHERE application_id = $1
           UNION ALL
           SELECT id::text, 'update', action,
             CASE WHEN action = 'interview_stage.rescheduled' THEN metadata->>'previous_scheduled_at' END,
             CASE WHEN action = 'interview_stage.rescheduled' THEN metadata->>'scheduled_at' ELSE metadata->>'status' END,
             COALESCE(metadata->>'filename', metadata->>'round_number', metadata->>'round'),
             COALESCE(metadata->>'actor', actor_email), created_at, metadata->>'previous_time_zone', metadata->>'time_zone'
           FROM audit_logs WHERE entity_type = 'application' AND entity_id = $1
             AND (action IN ('interview_stage.added', 'interview_stage.updated', 'interview_stage.rescheduled', 'interview_stage.cancelled', 'interview_file.added',
                  'interview_file.shared', 'interview_file.hidden', 'interview_file.removed',
                  'application.interview_scheduled', 'custom_interview.updated', 'custom_interview.created')
                  OR action LIKE 'interview_audio.%'
                  OR (action = 'application.updated' AND (metadata->'fields') ?| ARRAY['next_action','follow_up_at']))
           UNION ALL
           SELECT 'interview:' || s.id, 'interview', 'Interview stage created', NULL, NULL,
             s.round_number::text, s.created_by, s.created_at, NULL, NULL
           FROM interview_schedules s WHERE s.application_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM audit_logs l WHERE l.entity_type = 'application' AND l.entity_id = $1
                 AND ((l.action = 'interview_stage.added' AND l.metadata->>'stage_id' = s.id::text)
                   OR (l.action = 'application.interview_scheduled' AND l.metadata->>'id' = s.id::text))
             )
         ) timeline ORDER BY created_at DESC NULLS LAST, id LIMIT 150`,
        [applicationId]
      ),
    ]);

    const visibleActivity = canShowInterviewDetails ? activity : activity.filter((event) =>
      !event.action.startsWith("interview_stage.") &&
      !event.action.startsWith("interview_file.") &&
      !event.action.startsWith("interview_audio.") &&
      event.action !== "application.interview_scheduled" &&
      event.kind !== "interview"
    );
    const data: ApplicationDetailData = { application, stages, files, activity: visibleActivity };
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error("[application-detail] Could not load application", code ?? "unknown");
    return NextResponse.json({ error: "Could not load application details." }, { status: 500 });
  }
}
