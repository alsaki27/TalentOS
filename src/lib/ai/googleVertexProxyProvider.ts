// src/lib/ai/googleVertexProxyProvider.ts
// Google Vertex AI via Cloud Run proxy. No API key, no service account JSON.
// Uses GOOGLE_VERTEX_PROXY_URL + GOOGLE_VERTEX_PROXY_SECRET to call the proxy.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool } from "@/lib/ai/provider";

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

export async function callVertexProxy(opts: {
  proxyUrl: string;
  proxySecret: string;
  model: string;
  system: string;
  messages: AiMessage[];
  tools: AiTool[];
}): Promise<AiResponse> {
  const geminiTools = toGeminiTools(opts.tools);

  const res = await fetch(`${opts.proxyUrl}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-proxy-secret": opts.proxySecret,
    },
    body: JSON.stringify({
      system: opts.system,
      contents: toGeminiContents(opts.messages),
      tools: geminiTools,
      model: opts.model,
      temperature: 0.2,
      maxOutputTokens: 2048,
      // Only meaningful (and only sent by the proxy) when no tools are active
      // this turn - see index.js's buildVertexBody for why the two are
      // mutually exclusive in Vertex's API.
      responseMimeType: "application/json",
    }),
  });

  if (res.status === 401) {
    throw new Error("Google Vertex Proxy: unauthorized (invalid proxy secret).");
  }
  if (res.status === 429) {
    throw new Error("Google Vertex Proxy: rate limit or quota exceeded.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Vertex Proxy error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const parts: GeminiPart[] = data.parts ?? [];
  const content = fromGeminiParts(parts);
  const hasToolUse = content.some((b) => b.type === "tool_use");

  return {
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    stopReason: hasToolUse ? "tool_use" : data.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn",
  };
}

export function getGoogleVertexProxyProvider(): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;

  if (!proxyUrl || !proxySecret) return null;

  return {
    send({ system, messages, tools }) {
      const model = process.env.GOOGLE_VERTEX_MODEL || DEFAULT_MODEL;
      return callVertexProxy({ proxyUrl, proxySecret, model, system, messages, tools });
    },
  };
}

export function getGoogleVertexFallbackProvider(): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;
  const fallbackModel = process.env.GOOGLE_VERTEX_FALLBACK_MODEL;

  if (!proxyUrl || !proxySecret || !fallbackModel) return null;

  return {
    send({ system, messages, tools }) {
      return callVertexProxy({ proxyUrl, proxySecret, model: fallbackModel, system, messages, tools });
    },
  };
}
