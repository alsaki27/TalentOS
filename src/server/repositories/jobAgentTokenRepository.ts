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

export type JobAgentTokenReservationStatus =
  | "active"
  | "consumed"
  | "settled"
  | "released"
  | "expired";

export interface JobAgentTokenReservationRow {
  id: string;
  reservation_key: string;
  token_id: string;
  batch_shard_id: string | null;
  run_id: string | null;
  business_date: string;
  reserved_amount_usd: number;
  settled_amount_usd: number | null;
  daily_limit_usd: number;
  status: JobAgentTokenReservationStatus;
  expires_at: string;
  released_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReservedJobAgentToken {
  reservation: JobAgentTokenReservationRow;
  id: string;
  token: string;
  label: string | null;
}

export const JOB_AGENT_DEFAULT_DAILY_SPEND_LIMIT_USD = 5.0;

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
    `WITH accounted AS (
       SELECT token_id, COALESCE(SUM(estimated_cost_usd), 0)::numeric AS amount
       FROM job_agent_runs
       WHERE token_id IS NOT NULL
         AND token_reservation_id IS NULL
         AND (started_at AT TIME ZONE 'Asia/Dhaka')::date =
             (NOW() AT TIME ZONE 'Asia/Dhaka')::date
       GROUP BY token_id
       UNION ALL
       SELECT token_id,
              COALESCE(SUM(COALESCE(settled_amount_usd, reserved_amount_usd)), 0)::numeric AS amount
       FROM job_agent_apify_token_reservations
       WHERE business_date = (NOW() AT TIME ZONE 'Asia/Dhaka')::date
         AND status IN ('active', 'consumed', 'settled')
         AND (status <> 'active' OR expires_at > NOW())
       GROUP BY token_id
     )
     SELECT token_id, COALESCE(SUM(amount), 0) AS total
     FROM accounted
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
 * If no priority is supplied, assign the next available priority (1-based) so the
 * UI's "lower runs first" convention stays consistent and priority-0 rows do not
 * unexpectedly win rotation.
 */
export async function insertToken(label: string | null, token: string, priority?: number): Promise<JobAgentTokenRow> {
  const encrypted = await encryptTokenSafe(token);

  let resolvedPriority = priority;
  if (resolvedPriority === undefined || resolvedPriority === null) {
    const maxRow = await queryOne<{ max_priority: number | null }>(
      "SELECT COALESCE(MAX(priority), 0) as max_priority FROM job_agent_apify_tokens"
    );
    resolvedPriority = (maxRow?.max_priority ?? 0) + 1;
  }

  const row = await queryOne<JobAgentTokenRow>(
    `INSERT INTO job_agent_apify_tokens (label, token_encrypted, priority) VALUES ($1, $2, $3) RETURNING *`,
    [label, encrypted, resolvedPriority]
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
    if (spend >= JOB_AGENT_DEFAULT_DAILY_SPEND_LIMIT_USD) continue;
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

/**
 * Atomically reserve projected spend and return a decrypted token. The token
 * row is locked while the reservation is inserted, preventing concurrent shard
 * launchers from all observing the same available budget.
 *
 * reservationKey must be stable for one logical attempt (for example
 * `${batchKey}:${shardKey}:attempt-1`). Calling again with the same key returns
 * that reservation instead of charging the budget twice.
 */
export async function reserveTokenAtomically(input: {
  reservationKey: string;
  businessDate: string;
  amountUsd: number;
  batchShardId?: string | null;
  dailyLimitUsd?: number;
  timezone?: string;
  ttlMinutes?: number;
}): Promise<ReservedJobAgentToken | null> {
  const reservationKey = input.reservationKey.trim();
  if (!reservationKey) throw new Error("Token reservation key is required");
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0) {
    throw new Error("Token reservation amount must be a non-negative finite number");
  }
  const dailyLimit = input.dailyLimitUsd ?? JOB_AGENT_DEFAULT_DAILY_SPEND_LIMIT_USD;
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) {
    throw new Error("Token daily limit must be a positive finite number");
  }
  if (input.ttlMinutes !== undefined && !Number.isFinite(input.ttlMinutes)) {
    throw new Error("Token reservation TTL must be a finite number");
  }
  const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? 30, 180));
  const timezone = input.timezone ?? "Asia/Dhaka";

  type ReservationWithSecret = JobAgentTokenReservationRow & {
    token_encrypted: string;
    token_label: string | null;
  };

  const row = await queryOne<ReservationWithSecret>(
    `WITH expired AS (
       UPDATE job_agent_apify_token_reservations
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' AND expires_at <= NOW()
       RETURNING id
     ),
     existing AS MATERIALIZED (
       SELECT token_id
       FROM job_agent_apify_token_reservations
       WHERE reservation_key = $1
       LIMIT 1
     ),
     candidate AS MATERIALIZED (
       SELECT t.id AS token_id
       FROM job_agent_apify_tokens t
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(r.estimated_cost_usd), 0)::numeric AS amount
         FROM job_agent_runs r
         WHERE r.token_id = t.id
           AND r.token_reservation_id IS NULL
           AND (r.started_at AT TIME ZONE $6)::date = $2::date
       ) run_spend ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(COALESCE(x.settled_amount_usd, x.reserved_amount_usd)), 0)::numeric AS amount
         FROM job_agent_apify_token_reservations x
         WHERE x.token_id = t.id
           AND x.business_date = $2::date
           AND x.status IN ('active', 'consumed', 'settled')
           AND (x.status <> 'active' OR x.expires_at > NOW())
       ) reservations ON true
       WHERE t.is_active = true
         AND (
           t.last_error_at IS NULL
           OR (t.last_error_at AT TIME ZONE $6)::date <> $2::date
         )
         AND COALESCE(run_spend.amount, 0) + COALESCE(reservations.amount, 0) + $3::numeric <= $5::numeric
         AND NOT EXISTS (SELECT 1 FROM existing)
       ORDER BY t.priority ASC, t.created_at ASC
       LIMIT 1
       FOR UPDATE OF t SKIP LOCKED
     ),
     selected AS (
       SELECT token_id FROM existing
       UNION ALL
       SELECT token_id FROM candidate
       LIMIT 1
     ),
     reserved AS (
       INSERT INTO job_agent_apify_token_reservations (
         reservation_key, token_id, batch_shard_id, business_date,
         reserved_amount_usd, daily_limit_usd, expires_at
       )
       SELECT $1, token_id, $4::uuid, $2::date, $3::numeric, $5::numeric,
              NOW() + ($7::text || ' minutes')::interval
       FROM selected
       ON CONFLICT (reservation_key) DO UPDATE
         SET reservation_key = EXCLUDED.reservation_key
       RETURNING *
     )
     SELECT reserved.*, t.token_encrypted, t.label AS token_label
     FROM reserved
     JOIN job_agent_apify_tokens t ON t.id = reserved.token_id`,
    [
      reservationKey,
      input.businessDate,
      input.amountUsd,
      input.batchShardId ?? null,
      dailyLimit,
      timezone,
      ttlMinutes,
    ]
  );

  if (!row) return null;
  if (row.business_date !== input.businessDate || Number(row.reserved_amount_usd) !== input.amountUsd) {
    throw new Error(`Token reservation ${reservationKey} was reused with different budget parameters`);
  }
  if (!(["active", "consumed", "settled"] as JobAgentTokenReservationStatus[]).includes(row.status)) {
    throw new Error(`Token reservation ${reservationKey} is already ${row.status}`);
  }

  const token = await decryptTokenSafe(row.token_encrypted);
  const { token_encrypted: _secret, token_label, ...reservation } = row;
  return { reservation, id: row.token_id, token, label: token_label };
}

export async function getTokenReservation(
  reservationId: string
): Promise<JobAgentTokenReservationRow | null> {
  return queryOne<JobAgentTokenReservationRow>(
    "SELECT * FROM job_agent_apify_token_reservations WHERE id = $1",
    [reservationId]
  );
}

/** Associate a live run with its reservation. Safe to repeat for the same run. */
export async function consumeTokenReservation(
  reservationId: string,
  runId: string
): Promise<JobAgentTokenReservationRow | null> {
  return queryOne<JobAgentTokenReservationRow>(
    `UPDATE job_agent_apify_token_reservations
     SET status = CASE WHEN status = 'active' THEN 'consumed' ELSE status END,
         run_id = COALESCE(run_id, $2::uuid),
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('active', 'consumed', 'settled')
       AND (run_id IS NULL OR run_id = $2::uuid)
     RETURNING *`,
    [reservationId, runId]
  );
}

/** Replace projected spend with the actor's final measured cost. */
export async function settleTokenReservation(
  reservationId: string,
  actualCostUsd: number
): Promise<JobAgentTokenReservationRow | null> {
  if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
    throw new Error("Actual token spend must be a non-negative finite number");
  }
  return queryOne<JobAgentTokenReservationRow>(
    `UPDATE job_agent_apify_token_reservations
     SET status = 'settled', settled_amount_usd = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('active', 'consumed', 'settled')
     RETURNING *`,
    [reservationId, actualCostUsd]
  );
}

/** Release only a not-yet-consumed reservation (for example actor launch failed). */
export async function releaseTokenReservation(
  reservationId: string,
  reason: string
): Promise<boolean> {
  const result = await execute(
    `UPDATE job_agent_apify_token_reservations
     SET status = 'released', released_reason = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active'`,
    [reservationId, reason]
  );
  return result.rowCount > 0;
}

export async function expireStaleTokenReservations(): Promise<number> {
  const result = await execute(
    `UPDATE job_agent_apify_token_reservations
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at <= NOW()`
  );
  return result.rowCount;
}
