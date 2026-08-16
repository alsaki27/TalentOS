import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const [upcoming, responses, history, signals, attention, contacts, outcomes] = await Promise.all([
    query(`SELECT s.id, s.scheduled_at, s.round_name, s.round_number, s.duration_minutes, s.status, s.location, s.meeting_link,
                  a.id application_id, c.id candidate_id, c.name candidate_name, j.title job_title, j.company company_name,
                  CASE WHEN s.scheduled_at <= now() + interval '48 hours' AND s.meeting_link IS NULL AND s.location IS NULL THEN 'missing_logistics'
                       WHEN s.scheduled_at <= now() + interval '48 hours' THEN 'imminent' ELSE 'scheduled' END risk
             FROM interview_schedules s
             JOIN applications a ON a.id = s.application_id
             JOIN candidates c ON c.id = a.candidate_id
             LEFT JOIN jobs j ON j.id = a.job_id
            WHERE s.scheduled_at >= now() AND s.scheduled_at <= now() + interval '30 days'
              AND lower(coalesce(s.status, 'scheduled')) NOT IN ('cancelled', 'rejected')
             ORDER BY s.scheduled_at ASC`),
    query(`SELECT c.id candidate_id, c.name candidate_name, count(DISTINCT ec.id)::int waiting_count,
                  min(ec.sent_at) oldest_waiting_at,
                  CASE WHEN min(ec.sent_at) < now() - interval '48 hours' THEN 'urgent'
                       WHEN min(ec.sent_at) < now() - interval '24 hours' THEN 'high' ELSE 'normal' END priority,
                  EXTRACT(EPOCH FROM (now() - min(ec.sent_at)))/3600.0 age_hours,
                  max(ai.id::text) action_item_id,
                  max(ai.assigned_to_user_id::text) assigned_to_user_id,
                  max(p.display_name) assigned_to_name
             FROM email_communications ec
             JOIN candidates c ON c.id = ec.candidate_id
             LEFT JOIN action_items ai ON ai.email_communication_id = ec.id AND ai.status IN ('open','in_progress')
             LEFT JOIN profiles p ON p.user_id = ai.assigned_to_user_id
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
    query(`SELECT type, count(*)::int count,
                  count(*) FILTER (WHERE priority = 'urgent')::int urgent_count,
                  count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now())::int overdue_count
             FROM action_items
            WHERE status IN ('open', 'in_progress')
            GROUP BY type ORDER BY overdue_count DESC, urgent_count DESC, count DESC`),
    query(`SELECT cp.candidate_id, c.name candidate_name, cp.email, cp.display_name, cp.contact_type,
                  cp.company, cp.last_seen_at, cp.inbound_count, cp.outbound_count, cp.last_subject,
                  q.status AS crm_sync_status, q.crm_record_url, q.last_error AS crm_sync_error
             FROM gmail_contact_profiles cp
             JOIN candidates c ON c.id = cp.candidate_id
             LEFT JOIN crm_contact_sync_queue q ON q.candidate_id = cp.candidate_id AND q.contact_email = cp.email
            ORDER BY cp.last_seen_at DESC LIMIT 250`),
    query(`SELECT lower(coalesce(s.status, 'scheduled')) status, count(*)::int count
             FROM interview_schedules s
            WHERE s.created_at >= now() - interval '90 days'
            GROUP BY 1 ORDER BY count DESC`),
  ]);

  const metrics = {
    urgentResponses: responses.filter((x: any) => x.priority === 'urgent').length,
    highResponses: responses.filter((x: any) => x.priority === 'high').length,
    interviewsNext48h: upcoming.filter((x: any) => new Date(x.scheduled_at).getTime() <= Date.now() + 48 * 60 * 60 * 1000).length,
    unlinkedSignals: signals.filter((x: any) => !x.application_id).length,
  };
  const alerts = [
    ...responses.filter((x: any) => x.priority === 'urgent').map((x: any) => ({ severity: 'urgent', kind: 'response', text: `${x.candidate_name} has a reply waiting more than 48 hours.` })),
    ...upcoming.filter((x: any) => x.risk === 'missing_logistics').map((x: any) => ({ severity: 'urgent', kind: 'interview', text: `${x.candidate_name}'s interview lacks a meeting link or location.` })),
    ...attention.filter((x: any) => Number(x.overdue_count) > 0).map((x: any) => ({ severity: 'high', kind: 'work', text: `${String(x.type).replaceAll('_', ' ')} has ${x.overdue_count} overdue item(s).` })),
  ];
  return NextResponse.json({ generatedAt: new Date().toISOString(), upcoming, responses, history, signals, attention, contacts, outcomes, alerts, metrics });
}
