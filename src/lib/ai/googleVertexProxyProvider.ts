// src/lib/ai/googleVertexProxyProvider.ts
// Google Vertex AI via Cloud Run proxy. No API key, no service account JSON.
// Uses GOOGLE_VERTEX_PROXY_URL + GOOGLE_VERTEX_PROXY_SECRET to call the proxy.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool } from "@/lib/ai/provider";
import { fromOpenAiChoice, toOpenAiMessages, toOpenAiTools } from "@/lib/ai/openAiCompatibleProvider";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

// Gemini's native part shapes (the subset this file actually produces/consumes).
interface GeminiTextPart { text: string }
interface GeminiFunctionCallPart { functionCall: { name: string; args: Record<string, unknown> } }
interface GeminiFunctionResponsePart { functionResponse: { name: string; response: Record<string, unknown> } }
type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;
interface GeminiContent { role: "user" | "model" | "function"; parts: GeminiPart[] }

// Previously this just flattened every AiMessage into a single text string per
// turn (including tool_use/tool_result rendered as "[Tool use: ...]" text) and
// never sent `tools` at all. The model was only ever told in the system prompt's
// plain English that tools exist - with no real function-calling API wired up,
// Gemini fell back to its own learned "tool_code" code-execution text pattern
// instead of a real structured function call (confirmed live: identical
// {"tool_code": "print(talent.list_jobs())"} output regardless of the actual
// user message). Building Gemini's native contents/tools shapes here instead, so
// it can use its real function-calling protocol the way Anthropic's provider
// already does for Claude.
function toGeminiContents(messages: AiMessage[]): GeminiContent[] {
  // tool_result blocks only carry toolUseId, not the original function name -
  // Gemini's functionResponse.name needs the actual function name to correlate
  // correctly, so build an id -> name lookup from every tool_use block that's
  // appeared earlier in this same conversation before converting anything.
  const nameByToolUseId = new Map<string, string>();
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "tool_use") nameByToolUseId.set(b.id, b.name);
    }
  }

  return messages.map((m) => {
    const parts: GeminiPart[] = [];
    for (const b of m.content) {
      if (b.type === "text") {
        if (b.text) parts.push({ text: b.text });
      } else if (b.type === "tool_use") {
        parts.push({ functionCall: { name: b.name, args: b.input } });
      } else if (b.type === "tool_result") {
        // Gemini expects functionResponse parts on a "function" role turn, not
        // attached to the name of the prior assistant message's role.
        const name = nameByToolUseId.get(b.toolUseId) ?? b.toolUseId;
        parts.push({ functionResponse: { name, response: { result: b.content } } });
      }
    }
    const hasFunctionResponse = m.content.some((b) => b.type === "tool_result");
    const role: GeminiContent["role"] = hasFunctionResponse ? "function" : m.role === "assistant" ? "model" : "user";
    return { role, parts };
  });
}

function toGeminiTools(tools: AiTool[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

function fromGeminiParts(parts: GeminiPart[]): AiContentBlock[] {
  const blocks: AiContentBlock[] = [];
  let callIndex = 0;
  for (const p of parts) {
    if ("text" in p && p.text) {
      blocks.push({ type: "text", text: p.text });
    } else if ("functionCall" in p) {
      blocks.push({
        type: "tool_use",
        // Gemini doesn't assign an id to function calls the way Anthropic does -
        // synthesizing one so tool_result blocks built from this response can
        // round-trip back through toolUseId (matched against this name+index in
        // toGeminiContents via the functionResponse.name field, which Gemini
        // only uses to correlate by function *name*, not by this id - the id
        // only needs to be unique enough for this app's own bookkeeping).
        id: `vertex_call_${callIndex++}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      });
    }
  }
  return blocks;
}

// Gemini 2.5 Flash/Flash-Lite support up to 65536 output tokens. Truncation
// mid-generation ("Unterminated string in JSON") has hit this pipeline twice
// now from ceilings that were too conservative (2048, then 8192) - cost is
// not a concern here, so this is set well above anything any stage actually
// produces, leaving real margin below the documented 65536 max in case a
// specific model variant (3.1 Pro preview vs. 2.5 Flash) caps slightly lower.
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

export async function callVertexProxy(opts: {
  proxyUrl: string;
  proxySecret: string;
  model: string;
  system: string;
  messages: AiMessage[];
  tools: AiTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseSchema?: Record<string, unknown>;
  responseMimeType?: string | null;
}): Promise<AiResponse> {
  var controller = new AbortController();
  var timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs);
  }
  try {
    const maxRetries = 3;
    let res: Response | null = null;
    let lastErrorBody = "";
    let lastStatus = 0;

    // LiteLLM exposes the OpenAI-compatible endpoint. Keep the configured
    // secret as the gateway root and normalize callers that still provide a
    // `/v1` suffix so both forms remain safe during rotation.
    const baseUrl = opts.proxyUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    const endpoint = `${baseUrl}/v1/chat/completions`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const responseFormat = opts.responseSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "talentos_output", schema: opts.responseSchema, strict: true },
              },
            }
          : opts.responseMimeType === "application/json"
            ? { response_format: { type: "json_object" } }
            : {};

        res = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.proxySecret}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: "system", content: opts.system }, ...toOpenAiMessages(opts.messages)],
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            stream: false,
            ...(opts.tools?.length ? { tools: toOpenAiTools(opts.tools) } : {}),
            // Keep these legacy fields during the proxy migration. Older
            // proxy builds ignored them, and retaining them makes the wire
            // contract compatible for a rolling deploy while the canonical
            // OpenAI response_format fields above are used by the new proxy.
            ...(opts.responseMimeType !== undefined || opts.responseSchema
              ? { responseMimeType: opts.responseMimeType ?? "application/json" }
              : {}),
            ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
            ...responseFormat,
          }),
        });

        if (res.ok) break;

        lastStatus = res.status;
        lastErrorBody = await res.text().catch(() => "");

        if (res.status === 503 || res.status === 502 || res.status === 504) {
          if (attempt < maxRetries) {
            console.warn(`[Vertex Proxy] ${res.status} error, retrying in 2s (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        }
        break; // break if not a retriable error or out of retries
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        if (attempt < maxRetries) {
          console.warn(`[Vertex Proxy] Network error, retrying in 2s (attempt ${attempt + 1}/${maxRetries})...`, err);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }

    if (!res) {
      throw new Error("Google Vertex Proxy: fetch failed entirely.");
    }

    if (res.status === 401) {
      throw new Error("Google Vertex Proxy: unauthorized (invalid proxy secret).");
    }
    if (res.status === 429) {
      throw new Error("Google Vertex Proxy: rate limit or quota exceeded.");
    }
    if (!res.ok) {
      throw new Error(`Google Vertex Proxy error (${lastStatus}): ${lastErrorBody}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (choice) return fromOpenAiChoice(choice, data.usage);

    // Rolling deployments can briefly return the pre-OpenAI Gemini shape.
    // Accept it so a proxy rollout never turns a healthy request into a hard
    // failure, while all new requests continue to use /v1/chat/completions.
    if (Array.isArray(data.parts)) {
      return {
        content: fromGeminiParts(data.parts as GeminiPart[]),
        stopReason: "end_turn",
        usage: data.usage
          ? { input_tokens: data.usage.prompt_tokens ?? 0, output_tokens: data.usage.completion_tokens ?? 0 }
          : undefined,
      };
    }

    throw new Error("Google Vertex Proxy returned no choices.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getGoogleVertexProxyProvider(modelOverride?: string): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;

  if (!proxyUrl || !proxySecret) return null;

  return {
    send({ system, messages, tools, temperature, maxTokens, timeoutMs, responseSchema, responseMimeType }) {
      const model = modelOverride || process.env.GOOGLE_VERTEX_MODEL || DEFAULT_MODEL;
      return callVertexProxy({ proxyUrl, proxySecret, model, system, messages, tools, temperature, maxTokens, timeoutMs, responseSchema, responseMimeType });
    },
  };
}

export function getGoogleVertexFallbackProvider(): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;
  const fallbackModel = process.env.GOOGLE_VERTEX_FALLBACK_MODEL;

  if (!proxyUrl || !proxySecret || !fallbackModel) return null;

  return {
    send({ system, messages, tools, temperature, maxTokens, timeoutMs, responseSchema, responseMimeType }) {
      return callVertexProxy({ proxyUrl, proxySecret, model: fallbackModel, system, messages, tools, temperature, maxTokens, timeoutMs, responseSchema, responseMimeType });
    },
  };
}
