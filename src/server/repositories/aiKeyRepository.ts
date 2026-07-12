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
  | "opencode"
  | "moonshot"
  | "openai_compatible"
  | "local";

export type ProviderMode = "native" | "openai_compatible" | "anthropic_compatible" | "custom";
export type ApiStyle = "responses" | "chat_completions" | "anthropic_messages" | "gemini_generate_content";

export interface DiscoveredModelInfo {
  id: string;
  displayName?: string;
  source: "provider" | "preset" | "manual";
  enabled?: boolean;
  supportsThinking?: boolean;
}

export type AiKeyStatus = "unknown" | "working" | "failing" | "disabled" | "rate_limited" | "quota_exhausted" | "invalid" | "invalid_credential" | "admin_limit_reached";

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
  // The admin-chosen default model from the per-key catalog (available_models).
  // Backfilled from `model` during migration 017; distinct from `model` so the
  // legacy single-default-field semantics stay untouched.
  default_model: string | null;
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
  // Provider mode / API style catalog & discovery metadata (migration 017)
  provider_mode: ProviderMode;
  api_style: ApiStyle | null;
  models_endpoint: string | null;
  chat_endpoint: string | null;
  auth_header_name: string | null;
  auth_scheme: string | null;
  custom_headers: Record<string, string> | null;
  available_models: DiscoveredModelInfo[];
  models_last_synced_at: string | null;
  models_sync_error: string | null;
  supports_model_discovery: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
  // Code-enforced deletion protection (migration 019) — for keys whose real
  // secret material lives outside this table (e.g. google_vertex_proxy reads
  // GOOGLE_VERTEX_PROXY_SECRET from Cloudflare env), where deleting the row
  // would silently break every automation routed to it with no recovery path.
  is_protected: boolean;
}

export interface AiApiKeyMetadata {
  id: string;
  provider: AiProvider;
  label: string;
  key_fingerprint: string;
  model: string | null;
  default_model: string | null;
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
  // Provider mode / API style catalog & discovery metadata (migration 017)
  provider_mode: ProviderMode;
  api_style: ApiStyle | null;
  models_endpoint: string | null;
  chat_endpoint: string | null;
  auth_header_name: string | null;
  auth_scheme: string | null;
  custom_headers: Record<string, string> | null;
  available_models: DiscoveredModelInfo[];
  models_last_synced_at: string | null;
  models_sync_error: string | null;
  supports_model_discovery: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
  is_protected: boolean;
}

export interface CreateAiKeyInput {
  provider: AiProvider;
  label: string;
  apiKey: string;
  model?: string | null;
  priority?: number;
  isEnabled?: boolean;
  createdBy?: string;
  providerMode?: ProviderMode;
  apiStyle?: ApiStyle | null;
  modelsEndpoint?: string | null;
  chatEndpoint?: string | null;
  authHeaderName?: string | null;
  authScheme?: string | null;
  customHeaders?: Record<string, string> | null;
  availableModels?: DiscoveredModelInfo[];
  defaultModel?: string | null;
  supportsModelDiscovery?: boolean;
  supportsTools?: boolean;
  supportsJsonMode?: boolean;
  supportsStreaming?: boolean;
  isProtected?: boolean;
}

export interface UpdateAiKeyInput {
  label?: string;
  model?: string | null;
  defaultModel?: string | null;
  priority?: number;
  is_enabled?: boolean;
  apiKey?: string;
  providerMode?: ProviderMode;
  apiStyle?: ApiStyle | null;
  modelsEndpoint?: string | null;
  chatEndpoint?: string | null;
  authHeaderName?: string | null;
  authScheme?: string | null;
  customHeaders?: Record<string, string> | null;
  supportsModelDiscovery?: boolean;
  supportsTools?: boolean;
  supportsJsonMode?: boolean;
  supportsStreaming?: boolean;
  isProtected?: boolean;
}

// Canonical metadata column list (NEVER includes encrypted_key).
// Shared by all metadata-returning SELECTs to keep the surface in sync.
const METADATA_COLUMNS = `id, provider, label, model, default_model, base_url, priority,
       is_enabled, status, last_tested_at, last_test_status,
       last_test_latency_ms, last_success_at, last_failure_at,
       last_error_code, last_error_message, usage_count, failure_count,
       daily_request_warning, daily_request_limit, monthly_request_limit,
       monthly_budget_warning_usd, monthly_budget_limit_usd, notes,
       key_fingerprint, created_by, created_at, updated_at,
       provider_mode, api_style, models_endpoint, chat_endpoint,
       auth_header_name, auth_scheme, custom_headers, available_models,
       models_last_synced_at, models_sync_error,
       supports_model_discovery, supports_tools, supports_json_mode, supports_streaming,
       is_protected`;

function toMetadata(row: AiApiKeyRow): AiApiKeyMetadata {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    key_fingerprint: row.key_fingerprint,
    model: row.model ?? null,
    default_model: row.default_model ?? null,
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
    provider_mode: row.provider_mode,
    api_style: row.api_style,
    models_endpoint: row.models_endpoint,
    chat_endpoint: row.chat_endpoint,
    auth_header_name: row.auth_header_name,
    auth_scheme: row.auth_scheme,
    custom_headers: row.custom_headers,
    available_models: row.available_models ?? [],
    models_last_synced_at: row.models_last_synced_at,
    models_sync_error: row.models_sync_error,
    supports_model_discovery: row.supports_model_discovery,
    supports_tools: row.supports_tools,
    supports_json_mode: row.supports_json_mode,
    supports_streaming: row.supports_streaming,
    is_protected: row.is_protected,
  };
}

/**
 * List all AI API keys, returning metadata only (no decrypted keys).
 */
export async function listAiKeys(): Promise<AiApiKeyMetadata[]> {
  if (isNeon()) {
    const rows = await query<AiApiKeyRow>(
      `SELECT ${METADATA_COLUMNS}
       FROM ai_api_keys ORDER BY priority ASC, created_at ASC`
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
      `SELECT ${METADATA_COLUMNS}
       FROM ai_api_keys WHERE is_enabled = $1 ORDER BY priority ASC, created_at ASC`,
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
      `INSERT INTO ai_api_keys (
         provider, label, encrypted_key, key_fingerprint, model, default_model,
         priority, is_enabled, status, created_by,
         provider_mode, api_style, models_endpoint, chat_endpoint,
         auth_header_name, auth_scheme, custom_headers, available_models,
         supports_model_discovery, supports_tools, supports_json_mode, supports_streaming,
         is_protected
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING ${METADATA_COLUMNS}`,
      [
        input.provider, input.label, encrypted, fingerprint,
        input.model ?? null, input.defaultModel ?? null,
        input.priority ?? 100, input.isEnabled ?? true, "unknown", input.createdBy ?? null,
        input.providerMode ?? "native", input.apiStyle ?? null,
        input.modelsEndpoint ?? null, input.chatEndpoint ?? null,
        input.authHeaderName ?? null, input.authScheme ?? null,
        input.customHeaders ? JSON.stringify(input.customHeaders) : null,
        input.availableModels ? JSON.stringify(input.availableModels) : JSON.stringify([]),
        input.supportsModelDiscovery ?? false,
        input.supportsTools ?? true,
        input.supportsJsonMode ?? true,
        input.supportsStreaming ?? false,
        input.isProtected ?? false,
      ]
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
        default_model: input.defaultModel ?? null,
        priority: input.priority ?? 100,
        is_enabled: input.isEnabled ?? true,
        status: "unknown",
        created_by: input.createdBy ?? null,
        provider_mode: input.providerMode ?? "native",
        api_style: input.apiStyle ?? null,
        models_endpoint: input.modelsEndpoint ?? null,
        chat_endpoint: input.chatEndpoint ?? null,
        auth_header_name: input.authHeaderName ?? null,
        auth_scheme: input.authScheme ?? null,
        custom_headers: input.customHeaders ?? null,
        available_models: input.availableModels ?? [],
        supports_model_discovery: input.supportsModelDiscovery ?? false,
        supports_tools: input.supportsTools ?? true,
        supports_json_mode: input.supportsJsonMode ?? true,
        supports_streaming: input.supportsStreaming ?? false,
        is_protected: input.isProtected ?? false,
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
    if (input.defaultModel !== undefined) {
      fields.push(`default_model = $${idx++}`);
      values.push(input.defaultModel);
    }
    if (input.priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      values.push(input.priority);
    }
    if (input.is_enabled !== undefined) {
      fields.push(`is_enabled = $${idx++}`);
      values.push(input.is_enabled);
    }
    if (input.providerMode !== undefined) {
      fields.push(`provider_mode = $${idx++}`);
      values.push(input.providerMode);
    }
    if (input.apiStyle !== undefined) {
      fields.push(`api_style = $${idx++}`);
      values.push(input.apiStyle);
    }
    if (input.modelsEndpoint !== undefined) {
      fields.push(`models_endpoint = $${idx++}`);
      values.push(input.modelsEndpoint);
    }
    if (input.chatEndpoint !== undefined) {
      fields.push(`chat_endpoint = $${idx++}`);
      values.push(input.chatEndpoint);
    }
    if (input.authHeaderName !== undefined) {
      fields.push(`auth_header_name = $${idx++}`);
      values.push(input.authHeaderName);
    }
    if (input.authScheme !== undefined) {
      fields.push(`auth_scheme = $${idx++}`);
      values.push(input.authScheme);
    }
    if (input.customHeaders !== undefined) {
      fields.push(`custom_headers = $${idx++}`);
      values.push(input.customHeaders ? JSON.stringify(input.customHeaders) : null);
    }
    if (input.supportsModelDiscovery !== undefined) {
      fields.push(`supports_model_discovery = $${idx++}`);
      values.push(input.supportsModelDiscovery);
    }
    if (input.supportsTools !== undefined) {
      fields.push(`supports_tools = $${idx++}`);
      values.push(input.supportsTools);
    }
    if (input.supportsJsonMode !== undefined) {
      fields.push(`supports_json_mode = $${idx++}`);
      values.push(input.supportsJsonMode);
    }
    if (input.supportsStreaming !== undefined) {
      fields.push(`supports_streaming = $${idx++}`);
      values.push(input.supportsStreaming);
    }
    if (input.isProtected !== undefined) {
      fields.push(`is_protected = $${idx++}`);
      values.push(input.isProtected);
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
      `UPDATE ai_api_keys SET ${fields.join(", ")} WHERE id = $${idx}
       RETURNING ${METADATA_COLUMNS}`,
      values
    );
    return toMetadata(rows[0]);
  } else {
    const updates: Record<string, unknown> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.model !== undefined) updates.model = input.model;
    if (input.defaultModel !== undefined) updates.default_model = input.defaultModel;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.providerMode !== undefined) updates.provider_mode = input.providerMode;
    if (input.apiStyle !== undefined) updates.api_style = input.apiStyle;
    if (input.modelsEndpoint !== undefined) updates.models_endpoint = input.modelsEndpoint;
    if (input.chatEndpoint !== undefined) updates.chat_endpoint = input.chatEndpoint;
    if (input.authHeaderName !== undefined) updates.auth_header_name = input.authHeaderName;
    if (input.authScheme !== undefined) updates.auth_scheme = input.authScheme;
    if (input.customHeaders !== undefined) updates.custom_headers = input.customHeaders;
    if (input.supportsModelDiscovery !== undefined) updates.supports_model_discovery = input.supportsModelDiscovery;
    if (input.supportsTools !== undefined) updates.supports_tools = input.supportsTools;
    if (input.supportsJsonMode !== undefined) updates.supports_json_mode = input.supportsJsonMode;
    if (input.supportsStreaming !== undefined) updates.supports_streaming = input.supportsStreaming;
    if (input.isProtected !== undefined) updates.is_protected = input.isProtected;
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
      `UPDATE ai_api_keys SET is_enabled = $1, status = $2, updated_at = $3 WHERE id = $4
       RETURNING ${METADATA_COLUMNS}`,
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
 * Persist a newly-discovered/refreshed model catalog for a key.
 * Does NOT touch encrypted_key — additive metadata update only.
 */
export async function updateAiKeyModels(
  id: string,
  models: DiscoveredModelInfo[],
  syncError: string | null
): Promise<void> {
  if (isNeon()) {
    await execute(
      `UPDATE ai_api_keys
       SET available_models = $1, models_last_synced_at = now(), models_sync_error = $2, updated_at = now()
       WHERE id = $3`,
      [JSON.stringify(models), syncError, id]
    );
  } else {
    await supabase
      .from("ai_api_keys")
      .update({
        available_models: models,
        models_last_synced_at: new Date().toISOString(),
        models_sync_error: syncError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
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
  const errLower = error.toLowerCase();
  let status: AiKeyStatus;
  if (errLower.includes("rate limit") || errLower.includes("429")) {
    status = "rate_limited";
  } else if (errLower.includes("quota") || errLower.includes("billing")) {
    status = "quota_exhausted";
  } else {
    status = "failing";
  }

  if (isNeon()) {
    const now = new Date().toISOString();
    await execute(
      `UPDATE ai_api_keys SET status = $1, last_failure_at = $2, last_tested_at = $3, last_error = $4, failure_count = failure_count + 1, updated_at = $5 WHERE id = $6`,
      [status, now, now, error, now, id]
    );
  } else {
    await supabase
      .from("ai_api_keys")
      .update({
        status,
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
