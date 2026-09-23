// src/lib/ai/index.ts
// Canonical AI-provider lookup. Production credentials and endpoint configuration
// are loaded from the Neon-backed Control Center. The synchronous helpers remain
// only for backward-compatible mock/test callers and never read provider secrets.
//
// Phase 2 addition: getProviderForCategory(category) reads ai_task_category_config
// to let admins route specific task categories to specific providers/keys.

import { getAnthropicProvider } from "@/lib/ai/anthropicProvider";
import { getNvidiaProvider } from "@/lib/ai/nvidiaProvider";
import { getGoogleVertexProxyProvider, getGoogleVertexFallbackProvider } from "@/lib/ai/googleVertexProxyProvider";
import { getGoogleProvider, getGoogleFallbackProvider } from "@/lib/ai/googleProvider";
import { getOpenAiProvider } from "@/lib/ai/openaiProvider";
import { getGlmProvider } from "@/lib/ai/glmProvider";
import { createMockProvider } from "@/lib/ai/mockProvider";
import { AiProvider } from "@/lib/ai/provider";
import { getActiveProviderWithFallback, buildProviderFromDbKey } from "@/server/services/aiProvider";
import { getAiKeyWithDecryptedKey, listEnabledAiKeys } from "@/server/repositories/aiKeyRepository";
import { queryOne } from "@/server/db/neon";

export interface ActiveProvider {
  provider: AiProvider;
  name: string;
}

export type AiTaskCategory =
  | "resume_studio"
  | "chat_assistant"
  | "parsing_extraction"
  | "content_generation"
  | "default";

export const AI_TASK_CATEGORIES: { value: AiTaskCategory; label: string }[] = [
  { value: "resume_studio", label: "Resume Studio" },
  { value: "chat_assistant", label: "Chat Assistant" },
  { value: "parsing_extraction", label: "Parsing & Extraction" },
  { value: "content_generation", label: "Content Generation" },
  { value: "default", label: "Default (fallback)" },
];

export function getProviderByName(name: string, modelOverride?: string | null): ActiveProvider | null {
  switch (name) {
    case "openai": {
      const provider = getOpenAiProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "openai" };
      break;
    }
    case "glm": {
      const provider = getGlmProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "glm" };
      break;
    }
    case "google_vertex_proxy": {
      const provider = getGoogleVertexProxyProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "google_vertex_proxy" };
      break;
    }
    case "google": {
      const provider = getGoogleProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "google" };
      break;
    }
    case "nvidia": {
      const provider = getNvidiaProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "nvidia" };
      break;
    }
    case "anthropic": {
      const provider = getAnthropicProvider(modelOverride ?? undefined);
      if (provider) return { provider, name: "anthropic" };
      break;
    }
    case "mock": {
      return { provider: createMockProvider(), name: "mock" };
    }
  }
  return null;
}

async function getDbProviderByName(name: string): Promise<ActiveProvider | null> {
  const dbKeys = await listEnabledAiKeys();
  const matching = dbKeys.filter((k) => k.provider === name);
  for (const key of matching) {
    const keyRow = await getAiKeyWithDecryptedKey(key.id);
    if (!keyRow) continue;
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
    if (provider) {
      return { provider, name: keyRow.provider as ActiveProvider["name"] };
    }
  }
  return null;
}

export function getActiveProvider(): ActiveProvider | null {
  const preferred = process.env.AI_PROVIDER;

  if (preferred === "mock") {
    return { provider: createMockProvider(), name: "mock" };
  }
  if (preferred === "openai") {
    const provider = getOpenAiProvider();
    if (provider) return { provider, name: "openai" };
  }
  if (preferred === "glm") {
    const provider = getGlmProvider();
    if (provider) return { provider, name: "glm" };
  }
  if (preferred === "google_vertex_proxy") {
    const provider = getGoogleVertexProxyProvider();
    if (provider) return { provider, name: "google_vertex_proxy" };
  }
  if (preferred === "google") {
    const provider = getGoogleProvider();
    if (provider) return { provider, name: "google" };
  }
  if (preferred === "nvidia") {
    const provider = getNvidiaProvider();
    if (provider) return { provider, name: "nvidia" };
  }
  if (preferred === "anthropic") {
    const provider = getAnthropicProvider();
    if (provider) return { provider, name: "anthropic" };
  }

  // Default priority: Anthropic > NVIDIA > Google Vertex Proxy > Google AI Studio >
  // OpenAI > GLM. OpenAI/GLM sit at the end of the *global* chain deliberately -
  // per the user, this default order doesn't matter much since they're testing on
  // Vertex for now and specifically want OpenAI for resume-studio tasks, which the
  // per-category routing (Phase 2) handles directly rather than the global chain.
  const anthropic = getAnthropicProvider();
  if (anthropic) return { provider: anthropic, name: "anthropic" };

  const nvidia = getNvidiaProvider();
  if (nvidia) return { provider: nvidia, name: "nvidia" };

  const googleVertex = getGoogleVertexProxyProvider();
  if (googleVertex) return { provider: googleVertex, name: "google_vertex_proxy" };

  const google = getGoogleProvider();
  if (google) return { provider: google, name: "google" };

  const openai = getOpenAiProvider();
  if (openai) return { provider: openai, name: "openai" };

  const glm = getGlmProvider();
  if (glm) return { provider: glm, name: "glm" };

  return null;
}

/**
 * Canonical async provider lookup. Production credentials are resolved from
 * Neon only so deployment secrets cannot shadow Control Center configuration.
 */
export async function getActiveProviderAsync(): Promise<ActiveProvider | null> {
  return getActiveProviderWithFallback();
}

/**
 * Per-task-category provider routing.
 * 1. Looks up ai_task_category_config for the given category.
 * 2. If ai_key_id is set, builds a provider from that exact DB key.
 * 3. If provider is set (no specific key), tries its highest-priority enabled
 *    Neon key.
 * 4. Falls back to getActiveProviderAsync() (global default chain) if no override
 *    is configured or the override provider is not actually available.
 */
export async function getProviderForCategory(
  category: AiTaskCategory
): Promise<ActiveProvider | null> {
  // 1. Look up ai_task_category_config for this category
  let row: { provider: string | null; ai_key_id: string | null } | null = null;

  row = await queryOne<{ provider: string | null; ai_key_id: string | null }>(
    `SELECT provider, ai_key_id FROM ai_task_category_config WHERE category = $1`,
    [category]
  );

  if (!row) {
    // No override configured — fall back to global default chain
    return getActiveProviderAsync();
  }

  // 2. If ai_key_id is set, build provider from that exact DB key
  if (row.ai_key_id) {
    const keyRow = await getAiKeyWithDecryptedKey(row.ai_key_id);
    if (!keyRow) return getActiveProviderAsync();
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
    if (!provider) return getActiveProviderAsync();
    return { provider, name: keyRow.provider as ActiveProvider["name"] };
  }

  // 3. Provider-only categories resolve from Neon.
  if (row.provider) {
    const dbProvider = await getDbProviderByName(row.provider);
    if (dbProvider) return dbProvider;
  }

  // 4. Fall back to global default chain
  return getActiveProviderAsync();
}
