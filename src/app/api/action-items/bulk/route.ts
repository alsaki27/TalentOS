import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, query } from "@/server/db/neon";

export async function POST(req: NextRequest) {
  const { response, context } = await requireCurrentUser();
  if (response) return response;
  if (!['admin','manager'].includes(context!.profile.role)) return NextResponse.json({ error: 'Only managers and admins can bulk-correct email tasks.' }, { status: 403 });
  const body = await req.json();
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  const status = body.status === 'dismissed' ? 'dismissed' : body.status === 'done' ? 'done' : null;
  if (!ids.length || !status) return NextResponse.json({ error: 'ids and status (dismissed or done) are required.' }, { status: 400 });
  const reason = String(body.reason || 'Bulk-corrected by manager').slice(0, 500);
  const items = await query<{ id: string; email_communication_id: string | null }>("SELECT id, email_communication_id FROM action_items WHERE id = ANY($1::uuid[]) AND status IN ('open','in_progress')", [ids]);
  await execute(`UPDATE action_items SET status=$1, resolved_at=COALESCE(resolved_at,now()), resolved_by_user_id=$2, decision_note=$3 WHERE id=ANY($4::uuid[]) AND status IN ('open','in_progress')`, [status, context!.profile.user_id, reason, items.map(x=>x.id)]);
  const emailIds = items.map(x=>x.email_communication_id).filter(Boolean) as string[];
  if (emailIds.length && status === 'dismissed') await execute("UPDATE email_communications SET needs_reply=false, suppression_reason=COALESCE(suppression_reason,'manager_feedback'), suppression_rule=COALESCE(suppression_rule,'manager_feedback') WHERE id=ANY($1::uuid[])", [emailIds]);
  return NextResponse.json({ updated: items.length, status });
}
