// src/server/repositories/gmailIntegrationRepository.ts
// Data access for integration_accounts (provider='gmail' rows only). Tokens are
// encrypted at rest using the same AES-256-GCM helper already used for AI API
// keys (src/server/security/secretCrypto.ts) — encryptSecret/decryptSecret both
// transparently handle already-plaintext legacy rows, so this is a safe retrofit
// with no backfill migration required; each row upgrades to encrypted on its
// next write (OAuth reconnect or token refresh).

import { query, queryOne, execute } from "@/server/db/neon";
import { encryptSecret, decryptSecret } from "@/server/security/secretCrypto";

export interface GmailAccountRow {
  id: string;
  candidate_id: string;
  email: string | null;
  scopes: string[];
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: "active" | "revoked" | "error";
  gmail_history_id: string | null;
}

export async function listActiveCandidateGmailAccounts(): Promise<GmailAccountRow[]> {
  return query<GmailAccountRow>(
    `SELECT id, candidate_id, email, scopes, access_token, refresh_token, token_expires_at, status, gmail_history_id
     FROM integration_accounts
     WHERE provider = 'gmail' AND owner_type = 'candidate' AND status = 'active' AND candidate_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = integration_accounts.candidate_id AND c.email_sync_paused = true)`
  );
}

export async function getDecryptedGmailAccount(id: string) {
  const row = await queryOne<GmailAccountRow>(
    `SELECT id, candidate_id, email, scopes, access_token, refresh_token, token_expires_at, status, gmail_history_id
     FROM integration_accounts WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return {
    ...row,
    access_token: await decryptSecret(row.access_token),
    refresh_token: row.refresh_token ? await decryptSecret(row.refresh_token) : null,
  };
}

export async function saveEncryptedGmailTokens(params: {
  id: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt: string | null;
}) {
  const encryptedAccess = await encryptSecret(params.accessToken);
  if (params.refreshToken) {
    const encryptedRefresh = await encryptSecret(params.refreshToken);
    await execute(
      `UPDATE integration_accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, status = 'active', sync_error = NULL, updated_at = now() WHERE id = $4`,
      [encryptedAccess, encryptedRefresh, params.tokenExpiresAt, params.id]
    );
  } else {
    await execute(
      `UPDATE integration_accounts SET access_token = $1, token_expires_at = $2, status = 'active', sync_error = NULL, updated_at = now() WHERE id = $3`,
      [encryptedAccess, params.tokenExpiresAt, params.id]
    );
  }
}

export async function markGmailAccountError(id: string, error: string) {
  await execute(
    `UPDATE integration_accounts SET status = 'error', sync_error = $1, updated_at = now() WHERE id = $2`,
    [error.slice(0, 500), id]
  );
}

export async function updateGmailHistoryId(id: string, historyId: string) {
  await execute(
    `UPDATE integration_accounts SET gmail_history_id = $1, last_synced_at = now(), updated_at = now() WHERE id = $2`,
    [historyId, id]
  );
}
