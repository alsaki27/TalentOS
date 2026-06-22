// src/lib/ai/index.ts
// Picks whichever AI provider is actually configured. Set AI_PROVIDER=anthropic or
// AI_PROVIDER=nvidia to force one; otherwise prefers Anthropic if its key is set,
// falling back to NVIDIA (Kimi K2 via integrate.api.nvidia.com) if not. Callers
// (chat route, digest cron) only see the AiProvider interface either way.
//
// Chunk 3.5 addition: getActiveProviderAsync() also tries DB-managed keys as
// fallback when no env-based provider is configured. This is the preferred path
// for new code; getActiveProvider() remains for backward compatibility.

import { getAnthropicProvider } from "@/lib/ai/anthropicProvider";
import { getNvidiaProvider } from "@/lib/ai/nvidiaProvider";
import { getGoogleVertexProxyProvider, getGoogleVertexFallbackProvider } from "@/lib/ai/googleVertexProxyProvider";
import { getGoogleProvider, getGoogleFallbackProvider } from "@/lib/ai/googleProvider";
import { getOpenAiProvider } from "@/lib/ai/openaiProvider";
import { getGlmProvider } from "@/lib/ai/glmProvider";
import { AiProvider } from "@/lib/ai/provider";
import { getActiveProviderWithFallback } from "@/server/services/aiProvider";

export interface ActiveProvider {
  provider: AiProvider;
  name: "anthropic" | "nvidia" | "google" | "google_vertex_proxy" | "openai" | "glm";
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
