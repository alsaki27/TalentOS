// src/server/services/aiProvider.ts
// AI provider management service. Bridges the admin key manager with the AI layer.
// Provides functions for testing DB-managed keys, recording health, and building
// providers from encrypted keys. Does NOT replace the existing env-based provider
// selection in src/lib/ai/index.ts — it extends it.

import { AiProvider } from "@/lib/ai/provider";
import { getAnthropicProvider } from "@/lib/ai/anthropicProvider";
import { getNvidiaProvider } from "@/lib/ai/nvidiaProvider";
import { getGoogleProvider } from "@/lib/ai/googleProvider";
import { getGoogleVertexProxyProvider, callVertexProxy } from "@/lib/ai/googleVertexProxyProvider";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";
import {
  listEnabledAiKeys,
  getAiKeyWithDecryptedKey,
  recordAiKeySuccess,
  recordAiKeyFailure,
  type AiProvider as DbAiProvider,
  type AiApiKeyMetadata,
} from "@/server/repositories/aiKeyRepository";

// Re-declare to avoid circular import with src/lib/ai/index.ts
interface ActiveProvider {
  provider: AiProvider;
  name: "anthropic" | "nvidia" | "google" | "google_vertex_proxy" | "openai" | "glm";
}

const TEST_PROMPT = "Say 'TalentOS test OK' and nothing else.";

/**
 * Build an AI provider from a DB-managed key.
 * Returns null if the provider adapter is not implemented for this provider type.
 * `model` is the per-key override from ai_api_keys.model (set via the admin AI Key
 * Manager UI) - undefined/null falls back to that provider's env var / built-in
 * default, same as the env-based providers in src/lib/ai/*Provider.ts.
 */
export function buildProviderFromDbKey(
  provider: DbAiProvider,
  apiKey: string,
  model?: string | null
): AiProvider | null {
  switch (provider) {
    case "google_vertex_proxy": {
      const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
      if (!proxyUrl) return null;
      // Delegates to the same conversion logic as the env-based provider
      // (src/lib/ai/googleVertexProxyProvider.ts) instead of duplicating it -
      // this case used to flatten messages to plain text and never sent `tools`
      // at all, which (a) never let Gemini use real function-calling and
      // (b) is now broken outright regardless, since the proxy was changed to
      // return a `parts` array instead of a flattened `text` field.
      return {
        send({ system, messages, tools }) {
          return callVertexProxy({
            proxyUrl,
            proxySecret: apiKey,
            model: model || process.env.GOOGLE_VERTEX_MODEL || "gemini-2.5-flash-lite",
            system,
            messages,
            tools,
          });
        },
      };
    }
    case "anthropic": {
      // Reuse the anthropic provider logic but with a custom key
      const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
      const ANTHROPIC_VERSION = "2023-06-01";
      const DEFAULT_MODEL = "claude-sonnet-4-6";
      const MAX_TOKENS = 256;
      return {
        async send({ system, messages }) {
          const res = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
              max_tokens: MAX_TOKENS,
              system,
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content.filter((b) => b.type === "text").map((b) => ({ type: "text", text: (b as { text: string }).text })),
              })),
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Anthropic API error (${res.status}): ${body}`);
          }
          const data = await res.json();
          return {
            content: (data.content ?? []).map((block: any) => ({ type: "text", text: block.text ?? "" })),
            stopReason: data.stop_reason ?? "end_turn",
          };
        },
      };
    }
    case "nvidia": {
      const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
      const DEFAULT_MODEL = "moonshotai/kimi-k2.6";
      return {
        async send({ system, messages }) {
          const res = await fetch(NVIDIA_API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: model || process.env.NVIDIA_MODEL || DEFAULT_MODEL,
              messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") }))],
              max_tokens: 128,
              temperature: 0.4,
              stream: false,
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`NVIDIA API error (${res.status}): ${body}`);
          }
          const data = await res.json();
          const choice = data.choices?.[0];
          if (!choice) throw new Error("NVIDIA API returned no choices.");
          return {
            content: choice.message?.content ? [{ type: "text", text: choice.message.content }] : [],
            stopReason: choice.finish_reason === "length" ? "max_tokens" : "end_turn",
          };
        },
      };
    }
    case "google": {
      const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
      const DEFAULT_MODEL = "gemini-2.5-flash-lite";
      return {
        async send({ system, messages }) {
          const resolvedModel = model || process.env.GOOGLE_MODEL || DEFAULT_MODEL;
          const url = `${GOOGLE_API_BASE}/${resolvedModel}:generateContent`;

          const geminiMessages = messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: m.content.map((b) => {
              if (b.type === "text") return { text: b.text };
              if (b.type === "tool_use") return { text: `[Tool use: ${b.name}]` };
              return { text: `[Tool result: ${(b as { content: string }).content}]` };
            }),
          }));

          const body: Record<string, any> = {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 64,
            },
          };

          if (system) {
            body.systemInstruction = {
              parts: [{ text: system }],
            };
          }

          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Google API error (${res.status}): ${body}`);
          }

          const data = await res.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: any) => p.text ?? "").join("\n") ?? "";
          const stopReason = candidate?.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn";
          return { content: [{ type: "text", text }], stopReason };
        },
      };
    }
    case "openai": {
      // "openai" was previously listed here returning null - selectable in the
      // admin AI Key Manager UI but silently non-functional, since this function
      // never actually built a real provider for it.
      return createOpenAiCompatibleProvider({
        apiUrl: "https://api.openai.com/v1/chat/completions",
        apiKey,
        model: model || process.env.OPENAI_MODEL || "gpt-4o",
        errorLabel: "OpenAI API",
      });
    }
    case "glm": {
      return createOpenAiCompatibleProvider({
        apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        apiKey,
        model: model || process.env.GLM_MODEL || "glm-4-plus",
        errorLabel: "GLM API",
      });
    }
    case "groq":
    case "openrouter":
    case "deepseek":
    case "local":
      return null;
    default:
      return null;
  }
}

/**
 * Test a single DB-managed key by sending a tiny request.
 * Returns success/failure metadata and updates the key's health status in the DB.
 */
export async function testAiKey(id: string): Promise<{
  success: boolean;
  error?: string;
  latencyMs: number;
}> {
  const start = Date.now();
  const keyRow = await getAiKeyWithDecryptedKey(id);
  if (!keyRow) {
    return { success: false, error: "Key not found", latencyMs: Date.now() - start };
  }

  const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
  if (!provider) {
    const err = `Provider adapter for "${keyRow.provider}" is not implemented yet.`;
    await recordAiKeyFailure(id, err);
    return { success: false, error: err, latencyMs: Date.now() - start };
  }

  try {
    await provider.send({
      system: "You are a test assistant.",
      messages: [{ role: "user", content: [{ type: "text", text: TEST_PROMPT }] }],
      tools: [],
    });
    await recordAiKeySuccess(id);
    return { success: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    const message = err.message ?? "Unknown provider error";
    await recordAiKeyFailure(id, message);
    return { success: false, error: message, latencyMs: Date.now() - start };
  }
}

/**
 * Get all enabled DB-managed AI keys, ordered by priority.
 */
export async function getEnabledAiKeys(): Promise<AiApiKeyMetadata[]> {
  return listEnabledAiKeys();
}

/**
 * Try to get an active provider using DB-managed keys as fallback.
 * First tries env-based providers (existing behavior), then falls back to DB keys.
 * This is a conservative integration — the main getActiveProvider() in src/lib/ai/index.ts
 * still handles the primary path. Callers that want fallback can use this instead.
 */
export async function getActiveProviderWithFallback(): Promise<ActiveProvider | null> {
  // Try existing env-based providers first
  const anthropic = getAnthropicProvider();
  if (anthropic) return { provider: anthropic, name: "anthropic" };

  const nvidia = getNvidiaProvider();
  if (nvidia) return { provider: nvidia, name: "nvidia" };

  const google = getGoogleProvider();
  if (google) return { provider: google, name: "google" };

  const googleVertex = getGoogleVertexProxyProvider();
  if (googleVertex) return { provider: googleVertex, name: "google_vertex_proxy" };

  // Fallback to DB-managed keys
  const dbKeys = await listEnabledAiKeys();
  for (const key of dbKeys) {
    const keyRow = await getAiKeyWithDecryptedKey(key.id);
    if (!keyRow) continue;
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
    if (provider) {
      return { provider, name: keyRow.provider as "anthropic" | "nvidia" | "google" | "google_vertex_proxy" | "openai" | "glm" };
    }
  }

  return null;
}
