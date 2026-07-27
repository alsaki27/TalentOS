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
import { PROVIDER_NATIVE_DEFAULTS } from "@/lib/ai/providerPresets";
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

// Single source of truth for the fallback maxTokens ceiling used by every
// DB-managed-key provider builder below. Matches the native Google env-key
// path (googleProvider.ts) and the Vertex Proxy (googleVertexProxyProvider.ts),
// both 8192. The per-stage value from AGENT_CONFIG_DEFAULTS[agentId].maxOutputTokens
// is always passed through .send({maxTokens}) by the agent layer, so this constant
// only governs the rare caller that doesn't supply one (e.g. testAiKey). A flat
// 4096 here previously meant a DB-key user on the same agent got a lower ceiling
// than the env-key path's 8192 — same call, different limit.
const FALLBACK_MAX_TOKENS = 8192;

/**
 * Build an AI provider from a DB-managed key.
 * Returns null if the provider adapter is not implemented for this provider type.
 * `model` is the per-key override from ai_api_keys.model (set via the admin AI Key
 * Manager UI) - undefined/null falls back to that provider's env var / built-in
 * default, same as the env-based providers in src/lib/ai/*Provider.ts.
 */
// A key's base_url and chat_endpoint are stored as two separate columns
// (sql/neon_fixes/017), but every case below used to fetch() `baseUrl`
// directly as the WHOLE api url whenever it was set, silently dropping
// chat_endpoint entirely. Confirmed live: a key with base_url
// "https://api.openai.com/v1" and chat_endpoint "/chat/completions" made
// requests to just "https://api.openai.com/v1" (OpenAI's API root, no
// chat-completions route there) -> 404 with an empty body, on every
// OpenAI-compatible-shaped provider (openai, glm, deepseek, moonshot,
// opencode, openai_compatible, groq, openrouter, local) - including the
// OpenCode key, independent of whether its endpoint was ever verified.
function resolveApiUrl(
  baseUrl: string | null | undefined,
  chatEndpoint: string | null | undefined,
  defaultFullUrl: string
): string {
  if (!baseUrl) return defaultFullUrl;
  const path = chatEndpoint || "/chat/completions";
  return baseUrl.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`);
}

export function buildProviderFromDbKey(
  provider: DbAiProvider,
  apiKey: string,
  model?: string | null,
  baseUrl?: string | null,
  chatEndpoint?: string | null
): AiProvider | null {
  switch (provider) {
    case "google_vertex_proxy": {
      // Prefer the Worker's own GOOGLE_VERTEX_PROXY_SECRET (matches the
      // pure-env fallback in getGoogleVertexProxyProvider()); fall back to
      // this key row's own apiKey only if that env var isn't set, so the
      // DB row still works standalone if the Cloudflare secret is ever
      // removed instead of hard-failing.
      const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
      const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET || apiKey;
      if (!proxyUrl || !proxySecret) {
        // A configured, enabled, healthy Vertex-Proxy route can still be
        // unusable if this host lacks the proxy env vars (e.g. a local dev
        // server whose .env.local doesn't carry the Cloudflare Worker
        // secrets). Returning null here silently skips the route and lets
        // routing fall through to the next rank / global fallback - which
        // surfaces downstream as a baffling "why is it using OpenAI" error.
        // Log loudly so the misconfiguration is diagnosable at the source.
        console.warn(
          `[aiProvider] google_vertex_proxy route skipped: missing ${!proxyUrl ? "GOOGLE_VERTEX_PROXY_URL" : "GOOGLE_VERTEX_PROXY_SECRET"} in this environment. ` +
            `The routed Vertex Proxy key cannot be used here; routing will fall back to a lower-rank route or the global fallback provider.`
        );
        return null;
      }
      return {
        send({ system, messages, tools, temperature, maxTokens }) {
          return callVertexProxy({
            proxyUrl,
            proxySecret,
            model: model || process.env.GOOGLE_VERTEX_MODEL || "gemini-2.5-flash-lite",
            system,
            messages,
            tools,
            temperature,
            maxTokens,
          });
        },
      };
    }
    case "anthropic": {
      const preset = PROVIDER_NATIVE_DEFAULTS["anthropic"];
      const defaultUrl = preset ? preset.baseUrl + preset.chatEndpoint : "https://api.anthropic.com/v1/messages";
      const apiUrl = resolveApiUrl(baseUrl, chatEndpoint, defaultUrl);
      const ANTHROPIC_VERSION = "2023-06-01";
      const DEFAULT_MODEL = "claude-sonnet-4-6";
      const DEFAULT_MAX_TOKENS = FALLBACK_MAX_TOKENS;
      return {
        async send({ system, messages, temperature, maxTokens }) {
          const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
              max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
              temperature,
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
            usage: data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : undefined,
          };
        },
      };
    }
    case "nvidia": {
      const preset = PROVIDER_NATIVE_DEFAULTS["nvidia"];
      const apiUrl = baseUrl || (preset ? preset.baseUrl + preset.chatEndpoint : "https://integrate.api.nvidia.com/v1/chat/completions");
      const DEFAULT_MODEL = "moonshotai/kimi-k2.6";
      return {
        async send({ system, messages, temperature, maxTokens }) {
          const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: model || process.env.NVIDIA_MODEL || DEFAULT_MODEL,
              messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") }))],
              max_tokens: maxTokens ?? FALLBACK_MAX_TOKENS,
              temperature: temperature ?? 0.4,
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
      const preset = PROVIDER_NATIVE_DEFAULTS["google"];
      const apiBase = baseUrl || (preset ? `${preset.baseUrl}/v1beta/models` : "https://generativelanguage.googleapis.com/v1beta/models");
      const DEFAULT_MODEL = "gemini-2.5-flash-lite";
      return {
        async send({ system, messages, temperature, maxTokens }) {
          const resolvedModel = model || process.env.GOOGLE_MODEL || DEFAULT_MODEL;
          const url = `${apiBase}/${resolvedModel}:generateContent`;

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
              temperature: temperature ?? 0.2,
              maxOutputTokens: maxTokens ?? FALLBACK_MAX_TOKENS,
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
      const preset = PROVIDER_NATIVE_DEFAULTS["openai"];
      const defaultUrl = preset ? preset.baseUrl + preset.chatEndpoint : "https://api.openai.com/v1/chat/completions";
      return createOpenAiCompatibleProvider({
        apiUrl: resolveApiUrl(baseUrl, chatEndpoint, defaultUrl),
        apiKey,
        model: model || process.env.OPENAI_MODEL || "gpt-4o",
        errorLabel: "OpenAI API",
      });
    }
    case "glm": {
      return createOpenAiCompatibleProvider({
        apiUrl: resolveApiUrl(baseUrl, chatEndpoint, "https://open.bigmodel.cn/api/paas/v4/chat/completions"),
        apiKey,
        model: model || process.env.GLM_MODEL || "glm-4-plus",
        errorLabel: "GLM API",
      });
    }
    case "deepseek": {
      const preset = PROVIDER_NATIVE_DEFAULTS["deepseek"];
      const defaultUrl = preset ? preset.baseUrl + preset.chatEndpoint : "https://api.deepseek.com/v1/chat/completions";
      return createOpenAiCompatibleProvider({
        apiUrl: baseUrl ? resolveApiUrl(baseUrl, chatEndpoint, defaultUrl) : (process.env.DEEPSEEK_API_BASE || defaultUrl),
        apiKey,
        model: model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
        errorLabel: "DeepSeek API",
        maxTokens: FALLBACK_MAX_TOKENS,
        temperature: 0.3,
        extraHeaders: {},
      });
    }
    case "moonshot": {
      const preset = PROVIDER_NATIVE_DEFAULTS["moonshot"];
      const defaultUrl = preset ? preset.baseUrl + preset.chatEndpoint : "https://api.moonshot.ai/v1/chat/completions";
      return createOpenAiCompatibleProvider({
        apiUrl: resolveApiUrl(baseUrl, chatEndpoint, defaultUrl),
        apiKey,
        model: model || process.env.MOONSHOT_MODEL || "kimi-k2.6",
        errorLabel: "Moonshot API",
      });
    }
    case "opencode": {
      return createOpenAiCompatibleProvider({
        apiUrl: baseUrl
          ? resolveApiUrl(baseUrl, chatEndpoint, baseUrl)
          : (process.env.OPENCODE_API_BASE || "https://api.opencode.ai/v1/chat/completions"),
        apiKey,
        model: model || process.env.OPENCODE_MODEL || "deepseek/deepseek-v4-flash",
        errorLabel: "OpenCode API",
        maxTokens: 8192,
        temperature: 0.3,
        extraHeaders: {},
      });
    }
    case "openai_compatible": {
      if (baseUrl) {
        return createOpenAiCompatibleProvider({
          apiUrl: resolveApiUrl(baseUrl, chatEndpoint, baseUrl),
          apiKey,
          model: model || "default",
          errorLabel: "OpenAI-Compatible API",
        });
      }
      return null;
    }
    case "groq":
    case "openrouter":
    case "local":
      if (baseUrl) {
        return createOpenAiCompatibleProvider({
          apiUrl: resolveApiUrl(baseUrl, chatEndpoint, baseUrl),
          apiKey,
          model: model || "default",
          errorLabel: provider,
        });
      }
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

  const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, (keyRow as any).base_url, (keyRow as any).chat_endpoint);
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
  const blockedStatuses = ["disabled", "rate_limited", "quota_exhausted", "invalid", "invalid_credential", "admin_limit_reached"];
  for (const key of dbKeys) {
    if (blockedStatuses.includes(key.status as any)) continue;
    const keyRow = await getAiKeyWithDecryptedKey(key.id);
    if (!keyRow) continue;
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, (keyRow as any).base_url, (keyRow as any).chat_endpoint);
    if (provider) {
      return { provider, name: keyRow.provider as "anthropic" | "nvidia" | "google" | "google_vertex_proxy" | "openai" | "glm" };
    }
  }

  return null;
}
