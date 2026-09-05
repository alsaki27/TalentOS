// src/server/services/aiProvider.ts
// AI provider management service. Bridges the admin key manager with the AI layer.
// Neon is the canonical provider-credential store; deployment configuration only
// supplies the independent encryption bootstrap.

import { AiProvider } from "@/lib/ai/provider";
import { callVertexProxy } from "@/lib/ai/googleVertexProxyProvider";
import { createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";
import { createOpenAiResponsesProvider } from "@/lib/ai/openAiResponsesProvider";
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
  name: string;
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
 * Manager UI). Undefined/null falls back to the adapter's non-secret built-in
 * model default.
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
  chatEndpoint?: string | null,
  customHeaders?: Record<string, string> | null,
  providerConfig?: Record<string, unknown> | null,
  reasoningEffort?: string | null,
): AiProvider | null {
  switch (provider) {
    case "google_vertex_proxy": {
      // The gateway URL, route, model alias, headers, and credential all come
      // from this decrypted Neon key record.
      const proxyUrl = baseUrl;
      const proxySecret = apiKey;
      if (!proxyUrl || !proxySecret) {
        // A configured, enabled Vertex route can still be unusable if its
        // Neon connection record is incomplete. Returning null here lets
        // routing fall through to the next rank / global fallback - which
        // surfaces downstream as a baffling "why is it using OpenAI" error.
        // Log loudly so the misconfiguration is diagnosable at the source.
        console.warn(
          `[aiProvider] google_vertex_proxy key skipped: missing ${!proxyUrl ? "base_url" : "encrypted credential"} in its Neon connection record.`
        );
        return null;
      }
      return {
        send({ system, messages, tools, temperature, maxTokens, responseSchema, responseMimeType }) {
          return callVertexProxy({
            proxyUrl,
            proxySecret,
            chatEndpoint: chatEndpoint || "/chat/completions",
            extraHeaders: customHeaders ?? undefined,
            model: model || String(providerConfig?.chat_model_alias || "coding-cheap"),
            system,
            messages,
            tools,
            temperature,
            maxTokens,
            responseSchema,
            responseMimeType,
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
        async send({ system, messages, tools, temperature, maxTokens, timeoutMs }) {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          if (timeoutMs && timeoutMs > 0) {
            timer = setTimeout(() => controller.abort(), timeoutMs);
          }

          try {
            const res = await fetch(apiUrl, {
              signal: controller.signal,
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: model || DEFAULT_MODEL,
                max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
                temperature,
                system,
                messages: messages.map((m) => ({
                  role: m.role,
                  content: m.content.map((block) => {
                    if (block.type === "text") return { type: "text", text: block.text };
                    if (block.type === "tool_use") {
                      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
                    }
                    return {
                      type: "tool_result",
                      tool_use_id: block.toolUseId,
                      content: block.content,
                      is_error: block.isError ?? false,
                    };
                  }),
                })),
                tools: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema,
                })),
              }),
            });
            if (!res.ok) {
              const body = await res.text();
              throw new Error(`Anthropic API error (${res.status}): ${body}`);
            }
            const data = await res.json();
            return {
              content: (data.content ?? []).map((block: any) => ({
                type: block.type === "tool_use" ? "tool_use" : "text",
                ...(block.type === "tool_use"
                  ? { id: block.id, name: block.name, input: block.input }
                  : { text: block.text ?? "" }),
              })),
              stopReason: data.stop_reason ?? "end_turn",
              usage: data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : undefined,
            };
          } catch (error: any) {
            if (controller.signal.aborted) {
              throw new Error(
                timeoutMs
                  ? `Anthropic request timed out after ${timeoutMs}ms`
                  : "Anthropic request timed out",
              );
            }
            throw error;
          } finally {
            if (timer) clearTimeout(timer);
          }
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
              model: model || DEFAULT_MODEL,
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
          const resolvedModel = model || DEFAULT_MODEL;
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
        model: model || "gpt-4o",
        errorLabel: "OpenAI API",
      });
    }
    case "glm": {
      return createOpenAiCompatibleProvider({
        apiUrl: resolveApiUrl(baseUrl, chatEndpoint, "https://open.bigmodel.cn/api/paas/v4/chat/completions"),
        apiKey,
        model: model || "glm-4-plus",
        errorLabel: "GLM API",
      });
    }
    case "deepseek": {
      const preset = PROVIDER_NATIVE_DEFAULTS["deepseek"];
      const defaultUrl = preset ? preset.baseUrl + preset.chatEndpoint : "https://api.deepseek.com/v1/chat/completions";
      return createOpenAiCompatibleProvider({
        apiUrl: resolveApiUrl(baseUrl, chatEndpoint, defaultUrl),
        apiKey,
        model: model || "deepseek-chat",
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
        model: model || "kimi-k2.6",
        errorLabel: "Moonshot API",
      });
    }
    case "opencode": {
      const selectedModel = model || "deepseek-v4-flash";
      const isGpt56Luna = /^gpt-5\.6-luna$/i.test(selectedModel);
      if (isGpt56Luna) {
        return createOpenAiResponsesProvider({
          apiUrl: baseUrl
            ? resolveApiUrl(baseUrl, "/responses", baseUrl)
            : "https://opencode.ai/zen/go/v1/responses",
          apiKey,
          model: selectedModel,
          maxOutputTokens: 8192,
          errorLabel: "OpenCode API",
        });
      }
      const normalizedReasoning = reasoningEffort && reasoningEffort !== "off" ? reasoningEffort : null;
      const deepSeekV4ProBody = /(?:^|\/)deepseek-v4-pro$/i.test(selectedModel)
        ? { thinking: { type: "enabled" }, reasoning_effort: normalizedReasoning || "high" }
        : normalizedReasoning
          ? { reasoning_effort: normalizedReasoning }
          : undefined;
      // Console Go's Kimi K2.7 Code endpoint rejects every temperature except
      // exactly 1. The application agents intentionally use lower temperatures
      // for deterministic JSON, so force the provider-specific value at the
      // transport boundary instead of changing every agent configuration.
      const kimiK27Body = /^kimi-k2\.7-code$/i.test(selectedModel)
        ? { temperature: 1 }
        : undefined;
      return createOpenAiCompatibleProvider({
        apiUrl: baseUrl
          ? resolveApiUrl(baseUrl, chatEndpoint, baseUrl)
          : "https://api.opencode.ai/v1/chat/completions",
        apiKey,
        model: selectedModel,
        errorLabel: "OpenCode API",
        maxTokens: 8192,
        temperature: 0.3,
        extraBody: {
          ...(deepSeekV4ProBody ?? {}),
          ...(kimiK27Body ?? {}),
        },
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

  const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
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
 * Get the first usable provider from the Neon-managed key pool.
 */
export async function getActiveProviderWithFallback(): Promise<ActiveProvider | null> {
  const dbKeys = await listEnabledAiKeys();
  for (const key of dbKeys) {
    if (["disabled", "invalid", "invalid_credential", "admin_limit_reached"].includes(key.status as any)) continue;
    if (["rate_limited", "quota_exhausted"].includes(key.status as any)) {
      const failedAt = key.last_failure_at ? Date.parse(key.last_failure_at) : Number.NaN;
      if (Number.isFinite(failedAt) && Date.now() - failedAt < 15 * 60_000) continue;
    }
    const keyRow = await getAiKeyWithDecryptedKey(key.id);
    if (!keyRow) continue;
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
    if (provider) {
      return { provider, name: keyRow.provider };
    }
  }

  return null;
}
