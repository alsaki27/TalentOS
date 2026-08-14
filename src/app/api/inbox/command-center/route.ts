import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const [upcoming, responses, history, signals] = await Promise.all([
    query(`SELECT s.id, s.scheduled_at, s.round_name, s.round_number, s.duration_minutes, s.status, s.location, s.meeting_link,
                  a.id application_id, c.id candidate_id, c.name candidate_name, j.title job_title, j.company company_name
             FROM interview_schedules s
             JOIN applications a ON a.id = s.application_id
             JOIN candidates c ON c.id = a.candidate_id
             LEFT JOIN jobs j ON j.id = a.job_id
            WHERE s.scheduled_at >= now() AND s.scheduled_at <= now() + interval '30 days'
              AND lower(coalesce(s.status, 'scheduled')) NOT IN ('cancelled', 'rejected')
             ORDER BY s.scheduled_at ASC`),
    query(`SELECT c.id candidate_id, c.name candidate_name, count(*)::int waiting_count,
                  min(ec.sent_at) oldest_waiting_at,
                  CASE WHEN min(ec.sent_at) < now() - interval '48 hours' THEN 'urgent'
                       WHEN min(ec.sent_at) < now() - interval '24 hours' THEN 'high' ELSE 'normal' END priority,
                  EXTRACT(EPOCH FROM (now() - min(ec.sent_at)))/3600.0 age_hours
             FROM email_communications ec
             JOIN candidates c ON c.id = ec.candidate_id
            WHERE ec.direction = 'inbound' AND ec.needs_reply = true AND ec.replied_at IS NULL
              AND coalesce(ec.suppression_reason, '') = ''
            GROUP BY c.id, c.name ORDER BY oldest_waiting_at ASC`),
    query(`SELECT c.id candidate_id, c.name candidate_name, s.id interview_id, s.scheduled_at,
                  s.round_name, s.status, a.id application_id, j.title job_title, j.company company_name
             FROM interview_schedules s
             JOIN applications a ON a.id = s.application_id
             JOIN candidates c ON c.id = a.candidate_id
             LEFT JOIN jobs j ON j.id = a.job_id
            WHERE s.scheduled_at < now() OR lower(coalesce(s.status, '')) IN ('completed', 'cancelled', 'no_show')
            ORDER BY s.scheduled_at DESC NULLS LAST LIMIT 250`),
    query(`SELECT c.id candidate_id, c.name candidate_name, ec.id email_id, ec.subject, ec.sent_at,
                  ec.ai_category, ec.ai_confidence, ec.ai_matched_application_id application_id,
                  j.title job_title, j.company company_name
             FROM email_communications ec
             JOIN candidates c ON c.id = ec.candidate_id
             LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
             LEFT JOIN jobs j ON j.id = a.job_id
            WHERE ec.ai_category IN ('interview_invite', 'scheduling', 'offer', 'rejection')
              AND ec.sent_at >= now() - interval '90 days'
            ORDER BY ec.sent_at DESC LIMIT 250`),
  ]);

  const metrics = {
    urgentResponses: responses.filter((x: any) => x.priority === 'urgent').length,
    highResponses: responses.filter((x: any) => x.priority === 'high').length,
    interviewsNext48h: upcoming.filter((x: any) => new Date(x.scheduled_at).getTime() <= Date.now() + 48 * 60 * 60 * 1000).length,
    unlinkedSignals: signals.filter((x: any) => !x.application_id).length,
  };
  return NextResponse.json({ generatedAt: new Date().toISOString(), upcoming, responses, history, signals, metrics });
}
