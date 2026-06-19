// src/server/repositories/aiKeyRepository.ts
// Data-access abstraction for the ai_api_keys table.
// Implementation uses Supabase today. All keys are encrypted before storage
// and decrypted only server-side when needed for testing or provider calls.

import { supabase } from "@/lib/supabase";
import { encryptSecret, decryptSecret, fingerprintKey } from "@/server/security/secretCrypto";

export type AiProvider =
  | "anthropic"
  | "nvidia"
  | "openai"
  | "google"
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
  priority?: number;
  isEnabled?: boolean;
  createdBy?: string;
}

export interface UpdateAiKeyInput {
  label?: string;
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
  const { data, error } = await supabase
    .from("ai_api_keys")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMetadata(r as AiApiKeyRow));
}

/**
 * List enabled AI API keys sorted by priority (lowest first).
 * Returns metadata only; callers must use getAiKeyWithDecryptedKey for the actual key.
 */
export async function listEnabledAiKeys(): Promise<AiApiKeyMetadata[]> {
  const { data, error } = await supabase
    .from("ai_api_keys")
    .select("*")
    .eq("is_enabled", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMetadata(r as AiApiKeyRow));
}

/**
 * Get a single AI key by ID, with the decrypted key for server-side use only.
 */
export async function getAiKeyWithDecryptedKey(id: string): Promise<(AiApiKeyRow & { decrypted_key: string }) | null> {
  const { data, error } = await supabase
    .from("ai_api_keys")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const row = data as AiApiKeyRow;
  return {
    ...row,
    decrypted_key: decryptSecret(row.encrypted_key),
  };
}

/**
 * Create a new AI API key. Encrypts the key before storage.
 */
export async function createAiKey(input: CreateAiKeyInput): Promise<AiApiKeyMetadata> {
  const encrypted = encryptSecret(input.apiKey);
  const fingerprint = fingerprintKey(input.apiKey);

  const { data, error } = await supabase
    .from("ai_api_keys")
    .insert({
      provider: input.provider,
      label: input.label,
      encrypted_key: encrypted,
      key_fingerprint: fingerprint,
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

/**
 * Update an AI API key. If apiKey is provided, re-encrypts and updates fingerprint.
 */
export async function updateAiKey(id: string, input: UpdateAiKeyInput): Promise<AiApiKeyMetadata> {
  const updates: Record<string, unknown> = {};
  if (input.label !== undefined) updates.label = input.label;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
  if (input.apiKey !== undefined) {
    updates.encrypted_key = encryptSecret(input.apiKey);
    updates.key_fingerprint = fingerprintKey(input.apiKey);
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

/**
 * Soft-disable an AI API key by setting is_enabled=false and status='disabled'.
 */
export async function disableAiKey(id: string): Promise<AiApiKeyMetadata> {
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

/**
 * Record a successful use of an AI key (increments usage_count, updates status).
 */
export async function recordAiKeySuccess(id: string): Promise<void> {
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

/**
 * Record a failure for an AI key (increments failure_count, updates status).
 */
export async function recordAiKeyFailure(id: string, error: string): Promise<void> {
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

// Helper to get current counts without race conditions (best effort)
async function getRawUsageCount(id: string): Promise<number> {
  const { data } = await supabase
    .from("ai_api_keys")
    .select("usage_count")
    .eq("id", id)
    .single();
  return (data?.usage_count as number) ?? 0;
}

async function getRawFailureCount(id: string): Promise<number> {
  const { data } = await supabase
    .from("ai_api_keys")
    .select("failure_count")
    .eq("id", id)
    .single();
  return (data?.failure_count as number) ?? 0;
}
