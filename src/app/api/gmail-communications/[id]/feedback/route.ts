import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response, context } = await requireCurrentUser();
  if (response) return response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Provide an email action.' }, { status: 400 }); }
  const kind = body.kind === 'relevant' ? 'relevant' : body.kind === 'noise' ? 'noise' : body.kind === 'needs_reply' ? 'needs_reply' : body.kind === 'no_reply_needed' ? 'no_reply_needed' : body.kind === 'mark_replied' ? 'mark_replied' : null;
  if (!kind) return NextResponse.json({ error: 'kind must be relevant, noise, needs_reply, no_reply_needed, or mark_replied' }, { status: 400 });
  const email = await queryOne<{ id: string; candidate_id: string; gmail_thread_id: string; needs_reply: boolean }>('SELECT id,candidate_id,gmail_thread_id,needs_reply FROM email_communications WHERE id=$1',[params.id]);
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  if (kind === 'noise') {
    await execute("UPDATE email_communications SET ai_relevant=false, needs_reply=false, suppression_reason='manager_feedback', suppression_rule='manual_feedback' WHERE id=$1", [params.id]);
    await execute("UPDATE action_items SET status='dismissed', resolved_at=COALESCE(resolved_at,now()), resolved_by_user_id=$1, decision_note='Dismissed as noise by human review' WHERE email_communication_id=$2 AND status IN ('open','in_progress')", [context!.profile.user_id, params.id]);
  } else if (kind === 'relevant') {
    await execute("UPDATE email_communications SET ai_relevant=true, suppression_reason=NULL, suppression_rule=NULL WHERE id=$1", [params.id]);
  } else if (kind === 'no_reply_needed') {
    await execute("UPDATE email_communications SET needs_reply=false, manual_replied_at=NULL, response_due_at=NULL, workflow_state='resolved', escalation_level=0 WHERE gmail_thread_id=$1 AND direction='inbound' AND replied_at IS NULL AND manual_replied_at IS NULL AND public.email_detected_team_reply_at(id) IS NULL", [email.gmail_thread_id]);
    await execute("UPDATE action_items SET status='dismissed', resolved_at=COALESCE(resolved_at,now()), resolved_by_user_id=$1, decision_note='Marked no reply needed by human review' WHERE email_communication_id IN (SELECT id FROM email_communications WHERE gmail_thread_id=$2 AND direction='inbound') AND type='needs_reply' AND status IN ('open','in_progress')", [context!.profile.user_id, email.gmail_thread_id]);
    // This classification applies to the shared thread, so its now-obsolete
    // waiting/overdue reminders should be acknowledged for every recipient.
    await execute("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE entity_type='email_communication' AND entity_id IN (SELECT id FROM email_communications WHERE gmail_thread_id=$1 AND direction='inbound') AND type IN ('email_reply_waiting','email_reply_overdue') AND read_at IS NULL", [email.gmail_thread_id]);
  } else if (kind === 'mark_replied') {
    if (!email.needs_reply) return NextResponse.json({ error: 'This message has no open reply task.' }, { status: 409 });
    await execute(
      `UPDATE email_communications inbound
          SET needs_reply = false,
              manual_replied_at = CASE
                WHEN public.email_detected_team_reply_at(inbound.id) IS NULL AND inbound.replied_at IS NULL
                  THEN COALESCE(inbound.manual_replied_at, now())
                ELSE NULL
              END,
              replied_at = COALESCE(public.email_detected_team_reply_at(inbound.id), inbound.replied_at),
              response_due_at = NULL,
              workflow_state = 'resolved',
              escalation_level = 0
        WHERE inbound.gmail_thread_id = $1
          AND inbound.direction = 'inbound'
          AND (inbound.needs_reply = true OR inbound.manual_replied_at IS NOT NULL)`,
      [email.gmail_thread_id],
    );
    await execute(
      `UPDATE action_items
          SET status='done', resolved_at=COALESCE(resolved_at,now()), resolved_by_user_id=$1,
              resolution_kind='manual_resolution', decision_note='Marked replied by a team member'
        WHERE email_communication_id IN (SELECT id FROM email_communications WHERE gmail_thread_id=$2 AND direction='inbound')
          AND type='needs_reply' AND status IN ('open','in_progress')`,
      [context!.profile.user_id, email.gmail_thread_id],
    );
    await execute("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE entity_type='email_communication' AND entity_id IN (SELECT id FROM email_communications WHERE gmail_thread_id=$1 AND direction='inbound') AND type IN ('email_reply_waiting','email_reply_overdue') AND read_at IS NULL", [email.gmail_thread_id]);
  } else {
    await execute("UPDATE email_communications SET needs_reply=true, manual_replied_at=NULL, replied_at=NULL, response_due_at=sent_at + interval '24 hours', workflow_state='needs_action', suppression_reason=NULL, suppression_rule=NULL WHERE id=$1", [params.id]);
  }
  await execute("INSERT INTO candidate_workflow_events (candidate_id,email_communication_id,event_type,actor_type,actor_user_id,payload) VALUES ($1,$2,'email_feedback','ae',$3,$4)", [email.candidate_id, params.id, context!.profile.user_id, JSON.stringify({ kind })]);
  return NextResponse.json({ ok: true, kind });
}
