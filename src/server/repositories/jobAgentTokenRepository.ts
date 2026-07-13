// src/server/repositories/jobAgentTokenRepository.ts
// Token pool management with auto-rotation.
// Picks the lowest-priority active token with today's spend under $5 and no errors.

import { query, queryOne, execute } from "@/server/db/neon";
import { encryptSecret, decryptSecret, isEncryptionAvailable } from "@/server/security/secretCrypto";

export interface JobAgentTokenRow {
  id: string;
  label: string | null;
  token_encrypted: string;
  priority: number;
  is_active: boolean;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

const DAILY_SPEND_LIMIT = 5.0;

async function encryptTokenSafe(token: string): Promise<string> {
  if (isEncryptionAvailable()) return await encryptSecret(token);
  console.warn("[job-agent] Storing Apify token without encryption — set AI_KEYS_ENCRYPTION_SECRET");
  return "bare:" + token;
}

async function decryptTokenSafe(encrypted: string): Promise<string> {
  if (encrypted.startsWith("bare:")) {
    return encrypted.slice(5);
  }
  return await decryptSecret(encrypted);
}

async function getTodaySpendForAllTokens(): Promise<Record<string, number>> {
  const rows = await query<{ token_id: string; total: number }>(
    `SELECT token_id, COALESCE(SUM(estimated_cost_usd), 0) as total
     FROM job_agent_runs 
     WHERE started_at >= CURRENT_DATE 
     GROUP BY token_id`
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.token_id] = Number(r.total ?? 0);
  return map;
}

/**
 * List all tokens (encrypted values masked).
 */
export async function listTokens(): Promise<{ id: string; label: string | null; priority: number; is_active: boolean; last_error: string | null; last_error_at: string | null }[]> {
  const rows = await query<JobAgentTokenRow>(
    `SELECT id, label, priority, is_active, last_error, last_error_at FROM job_agent_apify_tokens ORDER BY priority ASC, created_at ASC`
  );
  return rows.map((r) => ({ id: r.id, label: r.label, priority: r.priority, is_active: r.is_active, last_error: r.last_error, last_error_at: r.last_error_at }));
}

/**
 * Get a decrypted token string by ID.
 */
export async function getTokenById(id: string): Promise<string | null> {
  const row = await queryOne<{ token_encrypted: string }>(`SELECT token_encrypted FROM job_agent_apify_tokens WHERE id = $1`, [id]);
  const encrypted = row?.token_encrypted;
  if (!encrypted) return null;
  return await decryptTokenSafe(encrypted);
}

/**
 * Add a new token to the pool.
 */
export async function insertToken(label: string | null, token: string, priority?: number): Promise<JobAgentTokenRow> {
  const encrypted = await encryptTokenSafe(token);
  const row = await queryOne<JobAgentTokenRow>(
    `INSERT INTO job_agent_apify_tokens (label, token_encrypted, priority) VALUES ($1, $2, $3) RETURNING *`,
    [label, encrypted, priority ?? 0]
  );
  if (!row) throw new Error("Insert failed");
  return row;
}

/**
 * Rotation: find the best available token, or return null if none available.
 * Order: lowest priority, active, today's spend < $5, no error today.
 */
export async function rotateToken(): Promise<{ id: string; token: string; label: string | null } | null> {
  const rows = await query<JobAgentTokenRow>(
    `SELECT * FROM job_agent_apify_tokens WHERE is_active = true ORDER BY priority ASC, created_at ASC`
  );

  const spends = await getTodaySpendForAllTokens();

  for (const row of rows) {
    // Skip tokens errored today (quota/limit) — they reset tomorrow
    if (row.last_error_at) {
      const errDate = new Date(row.last_error_at).toDateString();
      const today = new Date().toDateString();
      if (errDate === today) continue;
    }
    const spend = spends[row.id] || 0;
    if (spend >= DAILY_SPEND_LIMIT) continue;
    try {
      const token = await decryptTokenSafe(row.token_encrypted);
      return { id: row.id, token, label: row.label };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Mark a token with an error (rate limit, quota, etc.) — the rotation will skip it.
 */
export async function markTokenError(tokenId: string, error: string): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    `UPDATE job_agent_apify_tokens SET last_error = $1, last_error_at = $2, updated_at = $3 WHERE id = $4`,
    [error, now, now, tokenId]
  );
}

/**
 * Deactivate a token (permanently — used when the account is dead).
 */
export async function deactivateToken(tokenId: string): Promise<void> {
  const now = new Date().toISOString();
  await execute(`UPDATE job_agent_apify_tokens SET is_active = false, updated_at = $1 WHERE id = $2`, [now, tokenId]);
}

/**
 * Reactivate a previously-deactivated token.
 */
export async function activateToken(tokenId: string): Promise<void> {
  const now = new Date().toISOString();
  await execute(`UPDATE job_agent_apify_tokens SET is_active = true, updated_at = $1 WHERE id = $2`, [now, tokenId]);
}