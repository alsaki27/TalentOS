import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailCode, getGoogleEmail, getGrantedGmailScopes } from "@/lib/integrations/googleGmail";
import { queryOne, execute } from "@/server/db/neon";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";
import { encryptSecret, isEncryptionAvailable } from "@/server/security/secretCrypto";
import { canonicalUrl, configuredSharedGmailEmail } from "@/server/runtimeConfig";
import { runGmailSync } from "@/server/services/gmailSyncService";
import { backgroundDispatch } from "@/server/lib/waitUntil";

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
  // The shared mailbox is now the only supported Gmail integration.  Keep the
  // legacy candidate/profile persistence branch below intact for restoration,
  // but never let an old OAuth state create another active mailbox today.
  if (String(oauthState.owner_type) !== "shared_application_mailbox") {
    return oauthRedirect(oauthState, "error", "shared_mailbox_only");
  }
  if (providerError) return oauthRedirect(oauthState, "error", "google_denied");
  if (!code) return oauthRedirect(oauthState, "error", "missing_code");
  if (!isEncryptionAvailable()) return oauthRedirect(oauthState, "error", "encryption_unavailable");

  try {
    const token = await exchangeGmailCode(code);
    const scopes = await getGrantedGmailScopes(token.access_token, token.scope);
    const email = await getGoogleEmail(token.access_token, token.id_token);
    const expectedSharedEmail = configuredSharedGmailEmail();
    if (!email || email.trim().toLowerCase() !== expectedSharedEmail) {
      // Do not persist a token for the wrong Google account.  This is the
      // important guard that keeps a stale browser session or a reused OAuth
      // consent from silently switching the system mailbox.
      throw new Error("wrong_shared_mailbox");
    }
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
      // Shared mailbox upsert is atomic against the database's unique
      // (provider, owner_type) index. Two managers completing OAuth at the
      // same time therefore still leave exactly one account row and the most
      // recent refresh token wins deterministically.
      const shared = await queryOne<{ id: string }>(
        `INSERT INTO integration_accounts
           (provider, owner_type, owner_user_id, candidate_id, email, scopes, access_token,
            refresh_token, token_expires_at, status, metadata, gmail_history_id,
            gmail_backfill_page_token, gmail_backfill_complete, updated_at)
         VALUES ('gmail', 'shared_application_mailbox', $1, NULL, $2, $3, $4, $5, $6,
                 'active', $7::jsonb, NULL, NULL, false, NOW())
         ON CONFLICT (provider, owner_type)
           WHERE provider = 'gmail' AND owner_type = 'shared_application_mailbox'
         DO UPDATE SET
           owner_user_id = EXCLUDED.owner_user_id,
           email = EXCLUDED.email,
           scopes = EXCLUDED.scopes,
           access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, integration_accounts.refresh_token),
           token_expires_at = EXCLUDED.token_expires_at,
           status = 'active', sync_error = NULL,
           gmail_history_id = NULL, gmail_backfill_page_token = NULL,
           gmail_backfill_complete = false,
           metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id`,
        [oauthState.owner_user_id, email, scopes, accessToken, refreshToken, expiresAt, metadata],
      );
      accountId = shared?.id ?? null;
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
    // Start the first bounded backfill immediately after OAuth. The background
    // registration lets Cloudflare continue importing after the redirect
    // response, while the five-minute cron keeps advancing the cursor.
    // Shared-mailbox redesign: this used to only fire for owner_type
    // 'candidate' - now that the shared mailbox (owner=shared) is the
    // primary connection, it needs the same immediate-backfill treatment,
    // or connecting it would otherwise sit idle until the next cron tick.
    if (oauthState.owner_type === "candidate" || oauthState.owner_type === "shared_application_mailbox") {
      await backgroundDispatch(runGmailSync({ retryErrored: true }));
    }
    return oauthRedirect(oauthState, "connected");
  } catch (error) {
    console.error("[gmail-oauth-callback] OAuth callback failed", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    return oauthRedirect(oauthState, "error", error instanceof Error && error.message === "wrong_shared_mailbox" ? "wrong_shared_mailbox" : "connection_failed");
  }
}
