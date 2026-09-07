import { NextResponse } from "next/server";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { execute } from "@/server/db/neon";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { envFlag, gmailConfigurationReadiness } from "@/server/runtimeConfig";

// Kept as a function (rather than an unreachable top-level return) so the
// archived implementation below continues to type-check and can be restored.
function candidateGmailRetired(): boolean { return true; }

export async function GET() {
  // ARCHIVED 2026-09-07 — candidate-owned Gmail is retired.  Candidate
  // messages now arrive through the single shared application mailbox.  The
  // implementation below is intentionally left in place as a restore point,
  // but this endpoint must never start a second OAuth connection.
  if (candidateGmailRetired()) {
    return NextResponse.json(
      { error: "Candidate Gmail connections have been retired. Your application email is forwarded to Skarion's shared mailbox." },
      { status: 410 },
    );
  }

  if (!envFlag("CANDIDATE_GMAIL_ENABLED")) return NextResponse.json({ error: "CANDIDATE_GMAIL_DISABLED" }, { status: 503 });
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const readiness = gmailConfigurationReadiness();
  if (!readiness.ready || !isEncryptionAvailable()) {
    return NextResponse.json({ error: "CANDIDATE_GMAIL_NOT_READY", readiness: { ...readiness, tokenEncryptionReady: isEncryptionAvailable() } }, { status: 503 });
  }

  const state = newOAuthState();
  await execute(
    `INSERT INTO integration_oauth_states
       (state, provider, owner_type, candidate_id, redirect_after, expires_at)
     VALUES ($1, 'gmail', 'candidate', $2, '/portal', NOW() + INTERVAL '10 minutes')`,
    [state, context!.candidateId],
  );
  return NextResponse.redirect(gmailAuthUrl({ state }));
}
