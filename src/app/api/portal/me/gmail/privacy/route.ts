import { NextRequest, NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne, execute } from "@/server/db/neon";

export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const row = await queryOne<any>(
    `SELECT c.email_sync_paused, c.email_consent_at, c.email_retention_days,
            ia.id AS gmail_account_id, ia.email AS gmail_email, ia.status AS gmail_status,
            ia.scopes AS gmail_scopes, ia.last_synced_at AS gmail_last_synced_at,
            ia.sync_error AS gmail_sync_error
       FROM candidates c
       LEFT JOIN LATERAL (
         SELECT id, email, status, scopes, last_synced_at, sync_error
           FROM integration_accounts
          WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = c.id
          ORDER BY updated_at DESC LIMIT 1
       ) ia ON true
      WHERE c.id = $1`,
    [context!.candidateId],
  );
  return NextResponse.json(row || { email_sync_paused: false, email_consent_at: null, email_retention_days: 365, gmail_status: null });
}

export async function PATCH(req: NextRequest) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const body = await req.json().catch(() => ({}));
  const paused = typeof body.paused === "boolean" ? body.paused : null;
  const retentionDays = Number(body.retentionDays);
  if (paused === null && (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650)) return NextResponse.json({ error: "Provide paused or a retention period from 30 to 3650 days." }, { status: 400 });
  if (paused !== null) await execute("UPDATE candidates SET email_sync_paused = $1 WHERE id = $2", [paused, context!.candidateId]);
  if (Number.isInteger(retentionDays)) await execute("UPDATE candidates SET email_retention_days = $1 WHERE id = $2", [retentionDays, context!.candidateId]);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  await execute("DELETE FROM email_communications WHERE candidate_id = $1", [context!.candidateId]);
  await execute("DELETE FROM candidate_email_drafts WHERE candidate_id = $1", [context!.candidateId]);
  await execute("INSERT INTO candidate_workflow_events (candidate_id, event_type, actor_type, payload) VALUES ($1, 'email_history_deleted', 'candidate', '{}'::jsonb)", [context!.candidateId]);
  return NextResponse.json({ ok: true });
}
