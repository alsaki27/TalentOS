import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, getGoogleEmail, getGrantedGmailScopes } from "@/lib/integrations/googleGmail";
import { queryOne, execute } from "@/server/db/neon";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";
import { encryptSecret, isEncryptionAvailable } from "@/server/security/secretCrypto";
import { canonicalUrl } from "@/server/runtimeConfig";

type GmailOAuthState = {
  owner_type: string;
  owner_user_id: string | null;
  candidate_id: string | null;
  redirect_after: string | null;
};

function oauthRedirect(oauthState: GmailOAuthState, result: "connected" | "error", reason?: string) {
  const path = oauthState.redirect_after?.startsWith("/") && !oauthState.redirect_after.startsWith("//")
    ? oauthState.redirect_after
    : "/account";
  const url = canonicalUrl(path);
  url.searchParams.set("gmail", result);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const providerError = req.nextUrl.searchParams.get("error");
  if (!state) return NextResponse.json({ error: "OAuth state is required." }, { status: 400 });

  const oauthState = await queryOne<GmailOAuthState>(
    `DELETE FROM integration_oauth_states
      WHERE state = $1 AND provider = 'gmail' AND expires_at > NOW()
      RETURNING owner_type, owner_user_id, candidate_id, redirect_after`,
    [state],
  );
  if (!oauthState) return NextResponse.json({ error: "OAuth state is invalid, expired, or already used." }, { status: 400 });
  if (providerError) return oauthRedirect(oauthState, "error", "google_denied");
  if (!code) return oauthRedirect(oauthState, "error", "missing_code");
  if (!isEncryptionAvailable()) return oauthRedirect(oauthState, "error", "encryption_unavailable");

  try {
    const token = await exchangeGmailCode(code);
    const scopes = await getGrantedGmailScopes(token.access_token, token.scope);
    const email = await getGoogleEmail(token.access_token, token.id_token);
    const accessToken = await encryptSecret(token.access_token);
    const refreshToken = token.refresh_token ? await encryptSecret(token.refresh_token) : null;
    if (!accessToken.startsWith("enc:") || (refreshToken && !refreshToken.startsWith("enc:"))) {
      throw new Error("Gmail token encryption failed.");
    }
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    const metadata = JSON.stringify({ token_type: token.token_type ?? "Bearer" });

    let accountId: string | null = null;
    if (oauthState.owner_type === "candidate") {
      if (!oauthState.candidate_id) throw new Error("Candidate Gmail connection is missing its owner.");
      const account = await queryOne<{ id: string }>(
        `WITH account AS (
           INSERT INTO integration_accounts
             (provider, owner_type, owner_user_id, candidate_id, email, scopes, access_token,
              refresh_token, token_expires_at, status, metadata, updated_at)
           VALUES ('gmail', 'candidate', $1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, NOW())
           ON CONFLICT (provider, owner_type, candidate_id)
             WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id IS NOT NULL
           DO UPDATE SET
             owner_user_id = EXCLUDED.owner_user_id,
             email = EXCLUDED.email,
             scopes = EXCLUDED.scopes,
             access_token = EXCLUDED.access_token,
             refresh_token = COALESCE(EXCLUDED.refresh_token, integration_accounts.refresh_token),
             token_expires_at = EXCLUDED.token_expires_at,
             status = 'active',
             sync_error = NULL,
             gmail_history_id = NULL,
             gmail_backfill_page_token = NULL,
             gmail_backfill_complete = false,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()
           RETURNING id
         ), consent AS (
           UPDATE candidates
              SET email_consent_at = COALESCE(email_consent_at, NOW()), email_sync_paused = false
            WHERE id = $2
            RETURNING id
         )
         SELECT id FROM account`,
        [oauthState.owner_user_id, oauthState.candidate_id, email, scopes, accessToken, refreshToken, expiresAt, metadata],
      );
      accountId = account?.id ?? null;
    } else {
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM integration_accounts
          WHERE provider = 'gmail' AND owner_type = $1
            AND (($2::uuid IS NOT NULL AND owner_user_id = $2) OR ($2::uuid IS NULL AND owner_user_id IS NULL))
          LIMIT 1`,
        [oauthState.owner_type, oauthState.owner_user_id],
      );
      if (existing) {
        await execute(
          `UPDATE integration_accounts
              SET email = $1, scopes = $2, access_token = $3,
                  refresh_token = COALESCE($4, refresh_token), token_expires_at = $5,
                  status = 'active', sync_error = NULL, metadata = $6::jsonb, updated_at = NOW()
            WHERE id = $7`,
          [email, scopes, accessToken, refreshToken, expiresAt, metadata, existing.id],
        );
        accountId = existing.id;
      } else {
        const inserted = await queryOne<{ id: string }>(
          `INSERT INTO integration_accounts
             (provider, owner_type, owner_user_id, candidate_id, email, scopes, access_token,
              refresh_token, token_expires_at, status, metadata, updated_at)
           VALUES ('gmail', $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb, NOW())
           RETURNING id`,
          [oauthState.owner_type, oauthState.owner_user_id, oauthState.candidate_id, email, scopes, accessToken, refreshToken, expiresAt, metadata],
        );
        accountId = inserted?.id ?? null;
      }
    }
    if (!accountId) throw new Error("Gmail account could not be persisted.");

    await recordAuditEvent({
      actor_user_id: oauthState.owner_user_id,
      actor_email: email,
      action: "integration.gmail.connected",
      entity_type: "integration_account",
      entity_id: accountId,
      metadata: { owner_type: oauthState.owner_type, candidate_id: oauthState.candidate_id, email, scopes },
    });
    return oauthRedirect(oauthState, "connected");
  } catch (error) {
    console.error("[gmail-oauth-callback] OAuth callback failed", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    return oauthRedirect(oauthState, "error", "connection_failed");
  }
}
