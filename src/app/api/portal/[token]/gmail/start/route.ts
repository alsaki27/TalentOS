import { NextRequest, NextResponse } from "next/server";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { queryOne, execute } from "@/server/db/neon";
import { envFlag, gmailConfigurationReadiness } from "@/server/runtimeConfig";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!envFlag("CANDIDATE_GMAIL_ENABLED")) {
    return NextResponse.json({ error: "CANDIDATE_GMAIL_DISABLED" }, { status: 503 });
  }
  const readiness = gmailConfigurationReadiness();
  if (!readiness.ready || !isEncryptionAvailable()) {
    return NextResponse.json({ error: "CANDIDATE_GMAIL_NOT_READY" }, { status: 503 });
  }
  const candidate = await queryOne<{ id: string; portal_token_expires_at: string | null; portal_token_revoked_at: string | null }>(
    "SELECT id, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1",
    [params.token]
  );
  if (!candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at
    || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }

  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await execute(
    "INSERT INTO integration_oauth_states (state, provider, owner_type, candidate_id, redirect_after, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [state, "gmail", "candidate", candidate.id, `/portal/${params.token}`, expiresAt]
  );

  return NextResponse.redirect(gmailAuthUrl({ state }));
}
