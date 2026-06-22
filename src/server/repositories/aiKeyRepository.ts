// src/server/repositories/aiKeyRepository.ts
// Data-access abstraction for the ai_api_keys table.
// Implementation uses Supabase today. All keys are encrypted before storage
// and decrypted only server-side when needed for testing or provider calls.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db/index";
import { query, queryOne, execute } from "@/server/db/neon";
import { encryptSecret, decryptSecret, fingerprintKey } from "@/server/security/secretCrypto";

export type AiProvider =
  | "anthropic"
  | "nvidia"
  | "openai"
  | "glm"
  | "google"
  | "google_vertex_proxy"
  | "groq"
  | "openrouter"
  | "deepseek"
  | "local";

export type AiKeyStatus = "unknown" | "working" | "failing" | "disabled";

export interface AiApiKeyRow {
  id: string;
  provider: AiProvider;
  label: string;
  encrypted_key: string;
  key_fingerprint: string;
  // Per-key model override. Null means the provider's env-var default / built-in
  // fallback (existing behavior, unchanged) - this exists so the admin UI can
  // offer a model dropdown per key rather than one hardcoded default per provider.
  model: string | null;
  priority: number;
  is_enabled: boolean;
  status: AiKeyStatus;
  last_tested_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  usage_count: number;
  failure_count: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AiApiKeyMetadata {
  id: string;
  provider: AiProvider;
  label: string;
  key_fingerprint: string;
  model: string | null;
  priority: number;
  is_enabled: boolean;
  status: AiKeyStatus;
  last_tested_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  usage_count: number;
  failure_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateAiKeyInput {
  provider: AiProvider;
  label: string;
  apiKey: string;
  model?: string | null;
  priority?: number;
  isEnabled?: boolean;
  createdBy?: string;
}

export interface UpdateAiKeyInput {
  label?: string;
  model?: string | null;
  priority?: number;
  is_enabled?: boolean;
  apiKey?: string;
}

function toMetadata(row: AiApiKeyRow): AiApiKeyMetadata {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    key_fingerprint: row.key_fingerprint,
    model: row.model ?? null,
    priority: row.priority,
    is_enabled: row.is_enabled,
    status: row.status,
    last_tested_at: row.last_tested_at,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    last_error: row.last_error,
    usage_count: row.usage_count,
    failure_count: row.failure_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * List all AI API keys, returning metadata only (no decrypted keys).
 */
export async function listAiKeys(): Promise<AiApiKeyMetadata[]> {
  if (isNeon()) {
    const rows = await query<AiApiKeyRow>(
      `SELECT * FROM ai_api_keys ORDER BY priority ASC, created_at ASC`
    );
    return rows.map((r) => toMetadata(r));
  } else {
    const { data, error } = await supabase
      .from("ai_api_keys")
      .select("*")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => toMetadata(r as AiApiKeyRow));
  }
}

/**
 * List enabled AI API keys sorted by priority (lowest first).
 * Returns metadata only; callers must use getAiKeyWithDecryptedKey for the actual key.
 */
export async function listEnabledAiKeys(): Promise<AiApiKeyMetadata[]> {
  if (isNeon()) {
    const rows = await query<AiApiKeyRow>(
      `SELECT * FROM ai_api_keys WHERE is_enabled = $1 ORDER BY priority ASC, created_at ASC`,
      [true]
    );
    return rows.map((r) => toMetadata(r));
  } else {
    const { data, error } = await supabase
      .from("ai_api_keys")
      .select("*")
      .eq("is_enabled", true)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => toMetadata(r as AiApiKeyRow));
  }
}

/**
 * Get a single AI key by ID, with the decrypted key for server-side use only.
 */
export async function getAiKeyWithDecryptedKey(id: string): Promise<(AiApiKeyRow & { decrypted_key: string }) | null> {
  if (isNeon()) {
    const row = await queryOne<AiApiKeyRow>(
      `SELECT * FROM ai_api_keys WHERE id = $1`,
      [id]
    );
    if (!row) return null;
    return {
      ...row,
      decrypted_key: await decryptSecret(row.encrypted_key),
    };
  } else {
    const { data, error } = await supabase
      .from("ai_api_keys")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    const row = data as AiApiKeyRow;
    return {
      ...row,
      decrypted_key: await decryptSecret(row.encrypted_key),
    };
  }
}

/**
 * Create a new AI API key. Encrypts the key before storage.
 */
export async function createAiKey(input: CreateAiKeyInput): Promise<AiApiKeyMetadata> {
  const encrypted = await encryptSecret(input.apiKey);
  const fingerprint = await fingerprintKey(input.apiKey);

  if (isNeon()) {
    const rows = await query<AiApiKeyRow>(
      `INSERT INTO ai_api_keys (provider, label, encrypted_key, key_fingerprint, model, priority, is_enabled, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [input.provider, input.label, encrypted, fingerprint, input.model ?? null, input.priority ?? 100, input.isEnabled ?? true, "unknown", input.createdBy ?? null]
    );
    return toMetadata(rows[0]);
  } else {
    const { data, error } = await supabase
      .from("ai_api_keys")
      .insert({
        provider: input.provider,
        label: input.label,
        encrypted_key: encrypted,
        key_fingerprint: fingerprint,
        model: input.model ?? null,
        priority: input.priority ?? 100,
        is_enabled: input.isEnabled ?? true,
        status: "unknown",
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toMetadata(data as AiApiKeyRow);
  }
}

/**
 * Update an AI API key. If apiKey is provided, re-encrypts and updates fingerprint.
 */
export async function updateAiKey(id: string, input: UpdateAiKeyInput): Promise<AiApiKeyMetadata> {
  if (isNeon()) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (input.label !== undefined) {
      fields.push(`label = $${idx++}`);
      values.push(input.label);
    }
    if (input.model !== undefined) {
      fields.push(`model = $${idx++}`);
      values.push(input.model);
    }
    if (input.priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      values.push(input.priority);
    }
    if (input.is_enabled !== undefined) {
      fields.push(`is_enabled = $${idx++}`);
      values.push(input.is_enabled);
    }
    if (input.apiKey !== undefined) {
      fields.push(`encrypted_key = $${idx++}`);
      fields.push(`key_fingerprint = $${idx++}`);
      values.push(await encryptSecret(input.apiKey));
      values.push(await fingerprintKey(input.apiKey));
    }
    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(id);

    const rows = await query<AiApiKeyRow>(
      `UPDATE ai_api_keys SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return toMetadata(rows[0]);
  } else {
    const updates: Record<string, unknown> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.model !== undefined) updates.model = input.model;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.apiKey !== undefined) {
      updates.encrypted_key = await encryptSecret(input.apiKey);
      updates.key_fingerprint = await fingerprintKey(input.apiKey);
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("ai_api_keys")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toMetadata(data as AiApiKeyRow);
  }
}

/**
 * Soft-disable an AI API key by setting is_enabled=false and status='disabled'.
 */
export async function disableAiKey(id: string): Promise<AiApiKeyMetadata> {
  if (isNeon()) {
    const rows = await query<AiApiKeyRow>(
      `UPDATE ai_api_keys SET is_enabled = $1, status = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
      [false, "disabled", new Date().toISOString(), id]
    );
    return toMetadata(rows[0]);
  } else {
    const { data, error } = await supabase
      .from("ai_api_keys")
      .update({
        is_enabled: false,
        status: "disabled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toMetadata(data as AiApiKeyRow);
  }
}

/**
 * Record a successful use of an AI key (increments usage_count, updates status).
 */
export async function recordAiKeySuccess(id: string): Promise<void> {
  if (isNeon()) {
    const now = new Date().toISOString();
    await execute(
      `UPDATE ai_api_keys SET status = $1, last_success_at = $2, last_tested_at = $3, usage_count = usage_count + 1, updated_at = $4 WHERE id = $5`,
      ["working", now, now, now, id]
    );
  } else {
    await supabase
      .from("ai_api_keys")
      .update({
        status: "working",
        last_success_at: new Date().toISOString(),
        last_tested_at: new Date().toISOString(),
        usage_count: (await getRawUsageCount(id)) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }
}

/**
 * Record a failure for an AI key (increments failure_count, updates status).
 */
export async function recordAiKeyFailure(id: string, error: string): Promise<void> {
  if (isNeon()) {
    const now = new Date().toISOString();
    await execute(
      `UPDATE ai_api_keys SET status = $1, last_failure_at = $2, last_tested_at = $3, last_error = $4, failure_count = failure_count + 1, updated_at = $5 WHERE id = $6`,
      ["failing", now, now, error, now, id]
    );
  } else {
    await supabase
      .from("ai_api_keys")
      .update({
        status: "failing",
        last_failure_at: new Date().toISOString(),
        last_tested_at: new Date().toISOString(),
        last_error: error,
        failure_count: (await getRawFailureCount(id)) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }
}

// Helper to get current counts without race conditions (best effort)
async function getRawUsageCount(id: string): Promise<number> {
  if (isNeon()) {
    const row = await queryOne<{ usage_count: number }>(
      `SELECT usage_count FROM ai_api_keys WHERE id = $1`,
      [id]
    );
    return row?.usage_count ?? 0;
  } else {
    const { data } = await supabase
      .from("ai_api_keys")
      .select("usage_count")
      .eq("id", id)
      .single();
    return (data?.usage_count as number) ?? 0;
  }
}

async function getRawFailureCount(id: string): Promise<number> {
  if (isNeon()) {
    const row = await queryOne<{ failure_count: number }>(
      `SELECT failure_count FROM ai_api_keys WHERE id = $1`,
      [id]
    );
    return row?.failure_count ?? 0;
  } else {
    const { data } = await supabase
      .from("ai_api_keys")
      .select("failure_count")
      .eq("id", id)
      .single();
    return (data?.failure_count as number) ?? 0;
  }
}
