// src/server/repositories/jobAgentTokenRepository.ts
// Token pool management with auto-rotation.
// Picks the lowest-priority active token with today's spend under $5 and no errors.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
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
  if (process.env.NODE_ENV === "production" || !!process.env.CLOUDFLARE_WORKER) {
    throw new Error("AI_KEYS_ENCRYPTION_SECRET must be set in production.");
  }
  console.warn("[job-agent] Storing Apify token without encryption — set AI_KEYS_ENCRYPTION_SECRET");
  return "bare:" + token;
}

async function decryptTokenSafe(encrypted: string): Promise<string> {
  try {
    const d = await decryptSecret(encrypted);
    if (d.startsWith("bare:")) return d.slice(5);
    return d;
  } catch (err: any) {
    if (encrypted.startsWith("bare:") && !(process.env.NODE_ENV === "production")) return encrypted.slice(5);
    throw err;
  }
}

async function getTodaySpendForToken(tokenId: string): Promise<number> {
  if (isNeon()) {
    const row = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM job_agent_runs WHERE token_id = $1 AND started_at >= CURRENT_DATE`,
      [tokenId]
    );
    return Number(row?.total ?? 0);
  }
  const { data } = await supabase
    .from("job_agent_runs")
    .select("estimated_cost_usd")
    .eq("token_id", tokenId)
    .gte("started_at", new Date().toISOString().slice(0, 10));
  return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.estimated_cost_usd ?? 0), 0);
}

/**
 * List all tokens (encrypted values masked).
 */
export async function listTokens(): Promise<{ id: string; label: string | null; priority: number; is_active: boolean; last_error: string | null; last_error_at: string | null }[]> {
  if (isNeon()) {
    const rows = await query<JobAgentTokenRow>(
      `SELECT id, label, priority, is_active, last_error, last_error_at FROM job_agent_apify_tokens ORDER BY priority ASC, created_at ASC`
    );
    return rows.map((r) => ({ id: r.id, label: r.label, priority: r.priority, is_active: r.is_active, last_error: r.last_error, last_error_at: r.last_error_at }));
  }
  const { data, error } = await supabase.from("job_agent_apify_tokens").select("id, label, priority, is_active, last_error, last_error_at").order("priority", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, label: r.label, priority: r.priority, is_active: r.is_active, last_error: r.last_error, last_error_at: r.last_error_at }));
}

/**
 * Add a new token to the pool.
 */
export async function insertToken(label: string | null, token: string, priority?: number): Promise<JobAgentTokenRow> {
  const encrypted = await encryptTokenSafe(token);
  if (isNeon()) {
    const row = await queryOne<JobAgentTokenRow>(
      `INSERT INTO job_agent_apify_tokens (label, token_encrypted, priority) VALUES ($1, $2, $3) RETURNING *`,
      [label, encrypted, priority ?? 0]
    );
    if (!row) throw new Error("Insert failed");
    return row;
  }
  const { data, error } = await supabase.from("job_agent_apify_tokens").insert({ label, token_encrypted: encrypted, priority: priority ?? 0 }).select().single();
  if (error) throw new Error(error.message);
  return data as JobAgentTokenRow;
}

/**
 * Rotation: find the best available token, or return null if none available.
 * Order: lowest priority, active, today's spend < $5, no error today.
 */
export async function rotateToken(): Promise<{ id: string; token: string; label: string | null } | null> {
  let rows: JobAgentTokenRow[] = [];
  if (isNeon()) {
    rows = await query<JobAgentTokenRow>(
      `SELECT * FROM job_agent_apify_tokens WHERE is_active = true ORDER BY priority ASC, created_at ASC`
    );
  } else {
    const { data } = await supabase.from("job_agent_apify_tokens").select("*").eq("is_active", true).order("priority", { ascending: true }).order("created_at", { ascending: true });
    rows = (data ?? []) as JobAgentTokenRow[];
  }

  for (const row of rows) {
    // Skip tokens errored today (quota/limit) — they reset tomorrow
    if (row.last_error_at) {
      const errDate = new Date(row.last_error_at).toDateString();
      const today = new Date().toDateString();
      if (errDate === today) continue;
    }
    const spend = await getTodaySpendForToken(row.id);
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
  if (isNeon()) {
    await execute(
      `UPDATE job_agent_apify_tokens SET last_error = $1, last_error_at = $2, updated_at = $3 WHERE id = $4`,
      [error, now, now, tokenId]
    );
    return;
  }
  await supabase.from("job_agent_apify_tokens").update({ last_error: error, last_error_at: now, updated_at: now }).eq("id", tokenId);
}

/**
 * Deactivate a token (permanently — used when the account is dead).
 */
export async function deactivateToken(tokenId: string): Promise<void> {
  const now = new Date().toISOString();
  if (isNeon()) {
    await execute(`UPDATE job_agent_apify_tokens SET is_active = false, updated_at = $1 WHERE id = $2`, [now, tokenId]);
    return;
  }
  await supabase.from("job_agent_apify_tokens").update({ is_active: false, updated_at: now }).eq("id", tokenId);
}

/**
 * Reactivate a previously-deactivated token.
 */
export async function activateToken(tokenId: string): Promise<void> {
  const now = new Date().toISOString();
  if (isNeon()) {
    await execute(`UPDATE job_agent_apify_tokens SET is_active = true, updated_at = $1 WHERE id = $2`, [now, tokenId]);
    return;
  }
  await supabase.from("job_agent_apify_tokens").update({ is_active: true, updated_at: now }).eq("id", tokenId);
}