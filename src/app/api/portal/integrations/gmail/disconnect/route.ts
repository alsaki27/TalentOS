import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";
import { decryptSecret } from "@/server/security/secretCrypto";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

export async function POST() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const account = await queryOne<{ id: string; email: string | null; access_token: string | null; refresh_token: string | null }>(
    `SELECT id, email, access_token, refresh_token
       FROM integration_accounts
      WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1
      LIMIT 1`,
    [context!.candidateId],
  );
  if (!account) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  let providerRevoked = false;
  const encryptedToken = account.refresh_token || account.access_token;
  if (encryptedToken) {
    try {
      const token = await decryptSecret(encryptedToken);
      const revoke = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      providerRevoked = revoke.ok;
    } catch {
      providerRevoked = false;
    }
  }

  await queryOne(
    `WITH disconnected AS (
       UPDATE integration_accounts
          SET status = 'revoked', access_token = NULL, refresh_token = NULL,
              token_expires_at = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id
     ), paused AS (
       UPDATE candidates SET email_sync_paused = true WHERE id = $2 RETURNING id
     )
     SELECT id FROM disconnected`,
    [account.id, context!.candidateId],
  );
  await recordAuditEvent({
    actor_user_id: null,
    actor_email: context!.candidate.account_email,
    action: "integration.gmail.revoked",
    entity_type: "integration_account",
    entity_id: account.id,
    metadata: { candidate_id: context!.candidateId, email: account.email, provider_revoked: providerRevoked },
  });
  return NextResponse.json({ ok: true, providerRevoked });
}
