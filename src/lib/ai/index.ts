// src/lib/ai/index.ts
// Picks whichever AI provider is actually configured. Set AI_PROVIDER=anthropic or
// AI_PROVIDER=nvidia to force one; otherwise prefers Anthropic if its key is set,
// falling back to NVIDIA (Kimi K2 via integrate.api.nvidia.com) if not. Callers
// (chat route, digest cron) only see the AiProvider interface either way.
//
// Chunk 3.5 addition: getActiveProviderAsync() also tries DB-managed keys as
// fallback when no env-based provider is configured. This is the preferred path
// for new code; getActiveProvider() remains for backward compatibility.
//
// Phase 2 addition: getProviderForCategory(category) reads ai_task_category_config
// to let admins route specific task categories to specific providers/keys.

import { getAnthropicProvider } from "@/lib/ai/anthropicProvider";
import { getNvidiaProvider } from "@/lib/ai/nvidiaProvider";
import { getGoogleVertexProxyProvider, getGoogleVertexFallbackProvider } from "@/lib/ai/googleVertexProxyProvider";
import { getGoogleProvider, getGoogleFallbackProvider } from "@/lib/ai/googleProvider";
import { getOpenAiProvider } from "@/lib/ai/openaiProvider";
import { getGlmProvider } from "@/lib/ai/glmProvider";
import { AiProvider } from "@/lib/ai/provider";
import { getActiveProviderWithFallback, buildProviderFromDbKey } from "@/server/services/aiProvider";
import { getAiKeyWithDecryptedKey, listEnabledAiKeys } from "@/server/repositories/aiKeyRepository";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { supabase } from "@/lib/supabase";

export interface ActiveProvider {
  provider: AiProvider;
  name: "anthropic" | "nvidia" | "google" | "google_vertex_proxy" | "openai" | "glm";
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

function getProviderByName(name: string): ActiveProvider | null {
  switch (name) {
    case "openai": {
      const provider = getOpenAiProvider();
      if (provider) return { provider, name: "openai" };
      break;
    }
    case "glm": {
      const provider = getGlmProvider();
      if (provider) return { provider, name: "glm" };
      break;
    }
    case "google_vertex_proxy": {
      const provider = getGoogleVertexProxyProvider();
      if (provider) return { provider, name: "google_vertex_proxy" };
      break;
    }
    case "google": {
      const provider = getGoogleProvider();
      if (provider) return { provider, name: "google" };
      break;
    }
    case "nvidia": {
      const provider = getNvidiaProvider();
      if (provider) return { provider, name: "nvidia" };
      break;
    }
    case "anthropic": {
      const provider = getAnthropicProvider();
      if (provider) return { provider, name: "anthropic" };
      break;
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
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
    if (provider) {
      return { provider, name: keyRow.provider as ActiveProvider["name"] };
    }
  }
  return null;
}

export function getActiveProvider(): ActiveProvider | null {
  const preferred = process.env.AI_PROVIDER;

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
 * Async version that falls back to DB-managed keys when no env-based provider
 * is configured. Preferred for new code in workflow routes.
 */
export async function getActiveProviderAsync(): Promise<ActiveProvider | null> {
  // Try env-based providers first (same logic as sync version)
  const envProvider = getActiveProvider();
  if (envProvider) return envProvider;

  // Fallback to DB-managed keys
  return getActiveProviderWithFallback();
}

/**
 * Per-task-category provider routing.
 * 1. Looks up ai_task_category_config for the given category.
 * 2. If ai_key_id is set, builds a provider from that exact DB key.
 * 3. If provider is set (no specific key), tries the env-based getter for that
 *    provider, then its highest-priority enabled DB key.
 * 4. Falls back to getActiveProviderAsync() (global default chain) if no override
 *    is configured or the override provider is not actually available.
 */
export async function getProviderForCategory(
  category: AiTaskCategory
): Promise<ActiveProvider | null> {
  // 1. Look up ai_task_category_config for this category
  let row: { provider: string | null; ai_key_id: string | null } | null = null;

  if (isNeon()) {
    row = await queryOne<{ provider: string | null; ai_key_id: string | null }>(
      `SELECT provider, ai_key_id FROM ai_task_category_config WHERE category = $1`,
      [category]
    );
  } else {
    const { data } = await supabase
      .from("ai_task_category_config")
      .select("provider, ai_key_id")
      .eq("category", category)
      .single();
    if (data) row = data as any;
  }

  if (!row) {
    // No override configured — fall back to global default chain
    return getActiveProviderAsync();
  }

  // 2. If ai_key_id is set, build provider from that exact DB key
  if (row.ai_key_id) {
    const keyRow = await getAiKeyWithDecryptedKey(row.ai_key_id);
    if (!keyRow) return getActiveProviderAsync();
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
    if (!provider) return getActiveProviderAsync();
    return { provider, name: keyRow.provider as ActiveProvider["name"] };
  }

  // 3. If provider is set (no specific key), try env-based then DB keys
  if (row.provider) {
    const envProvider = getProviderByName(row.provider);
    if (envProvider) return envProvider;

    const dbProvider = await getDbProviderByName(row.provider);
    if (dbProvider) return dbProvider;
  }

  // 4. Fall back to global default chain
  return getActiveProviderAsync();
}
