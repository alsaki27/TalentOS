import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const candidateId = new URL(req.url).searchParams.get("candidateId")?.trim();
  if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
  const rows = await query(`
    SELECT occurred_at, event_type, title, detail, actor
      FROM (
        SELECT ec.sent_at occurred_at,
               'email' event_type,
               COALESCE(ec.subject, '(no subject)') title,
               COALESCE(ec.ai_summary, ec.snippet, '') detail,
               COALESCE(ec.from_email, CASE WHEN ec.direction = 'outbound' THEN 'TalentOS team' ELSE 'Unknown sender' END) actor
          FROM email_communications ec WHERE ec.candidate_id = $1
        UNION ALL
        SELECT s.scheduled_at occurred_at,
               'interview' event_type,
               s.round_name title,
               CONCAT_WS(' · ', COALESCE(j.title, 'Job unavailable'), COALESCE(j.company, '')) detail,
               COALESCE(s.created_by, 'system') actor
          FROM interview_schedules s
          JOIN applications a ON a.id = s.application_id
          LEFT JOIN jobs j ON j.id = a.job_id
         WHERE a.candidate_id = $1
        UNION ALL
        SELECT e.created_at occurred_at,
               e.event_type,
               REPLACE(e.event_type, '_', ' ') title,
               COALESCE(e.payload::text, '') detail,
               COALESCE(e.actor_type, 'system') actor
          FROM candidate_workflow_events e WHERE e.candidate_id = $1
      ) timeline
     ORDER BY occurred_at DESC NULLS LAST
     LIMIT 300`, [candidateId]);
  return NextResponse.json({ candidateId, timeline: rows });
}
