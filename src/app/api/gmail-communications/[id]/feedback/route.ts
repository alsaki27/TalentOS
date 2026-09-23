import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response, context } = await requireCurrentUser();
  if (response) return response;
  const body = await req.json();
  const kind = body.kind === 'relevant' ? 'relevant' : body.kind === 'noise' ? 'noise' : body.kind === 'needs_reply' ? 'needs_reply' : null;
  if (!kind) return NextResponse.json({ error: 'kind must be relevant, noise, or needs_reply' }, { status: 400 });
  const email = await queryOne<{ id: string; candidate_id: string }>('SELECT id,candidate_id FROM email_communications WHERE id=$1',[params.id]);
  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  if (kind === 'noise') {
    await execute("UPDATE email_communications SET ai_relevant=false, needs_reply=false, suppression_reason='manager_feedback', suppression_rule='manual_feedback' WHERE id=$1", [params.id]);
    await execute("UPDATE action_items SET status='dismissed', resolved_at=COALESCE(resolved_at,now()), resolved_by_user_id=$1, decision_note='Dismissed as noise by human review' WHERE email_communication_id=$2 AND status IN ('open','in_progress')", [context!.profile.user_id, params.id]);
  } else if (kind === 'relevant') {
    await execute("UPDATE email_communications SET ai_relevant=true, suppression_reason=NULL, suppression_rule=NULL WHERE id=$1", [params.id]);
  } else {
    await execute("UPDATE email_communications SET needs_reply=true, suppression_reason=NULL, suppression_rule=NULL WHERE id=$1", [params.id]);
  }
  await execute("INSERT INTO candidate_workflow_events (candidate_id,email_communication_id,event_type,actor_type,actor_user_id,payload) VALUES ($1,$2,'email_feedback','ae',$3,$4)", [email.candidate_id, params.id, context!.profile.user_id, JSON.stringify({ kind })]);
  return NextResponse.json({ ok: true, kind });
}
