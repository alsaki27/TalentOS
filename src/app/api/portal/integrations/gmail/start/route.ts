import { NextResponse } from "next/server";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { execute } from "@/server/db/neon";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { envFlag, gmailConfigurationReadiness } from "@/server/runtimeConfig";

export async function GET() {
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
