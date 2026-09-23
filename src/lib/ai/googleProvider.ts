// src/lib/ai/googleProvider.ts
// Google Gemini API via REST (no SDK dependency). Uses x-goog-api-key header.
// Requires GOOGLE_API_KEY. Supports GOOGLE_MODEL and GOOGLE_FALLBACK_MODEL.

import { AiContentBlock, AiMessage, AiProvider, AiResponse } from "@/lib/ai/provider";

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

function toGeminiContent(blocks: AiContentBlock[]): { text: string }[] {
  const parts: { text: string }[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ text: block.text });
    } else if (block.type === "tool_use") {
      parts.push({ text: `[Tool use: ${block.name}(${JSON.stringify(block.input)})]` });
    } else if (block.type === "tool_result") {
      parts.push({ text: `[Tool result: ${block.content}]` });
    }
  }
  return parts;
}

function toGeminiMessages(messages: AiMessage[]): { role: string; parts: { text: string }[] }[] {
  const out: { role: string; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    out.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiContent(m.content),
    });
  }
  return out;
}

function fromGeminiResponse(data: any): AiResponse {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    return { content: [{ type: "text", text: "" }], stopReason: "end_turn" };
  }
  const parts = candidate.content?.parts ?? [];
  const text = parts.map((p: any) => p.text ?? "").join("\n");
  const finishReason = candidate.finishReason;
  const stopReason = finishReason === "MAX_TOKENS" ? "max_tokens" : finishReason === "STOP" ? "end_turn" : "end_turn";
  return { content: [{ type: "text", text }], stopReason };
}

export function getGoogleProvider(modelOverride?: string, apiKey?: string, apiBase = GOOGLE_API_BASE): AiProvider | null {
  if (!apiKey) return null;

  return {
    async send({ system, messages, temperature, maxTokens, timeoutMs }) {
      const model = modelOverride || DEFAULT_MODEL;
      const url = `${apiBase}/${model}:generateContent`;

      const geminiMessages = toGeminiMessages(messages);

      const body: Record<string, any> = {
        contents: geminiMessages,
        generationConfig: {
          temperature: temperature ?? 0.2,
          maxOutputTokens: maxTokens ?? 8192,
        },
      };

      if (system) {
        body.systemInstruction = {
          parts: [{ text: system }],
        };
      }

      var controller = new AbortController();
      var timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      }
      try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
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
      return fromGeminiResponse(data);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export function getGoogleFallbackProvider(apiKey?: string, fallbackModel?: string, apiBase = GOOGLE_API_BASE): AiProvider | null {
  if (!apiKey || !fallbackModel) return null;

  return {
    async send({ system, messages, temperature, maxTokens, timeoutMs }) {
      const url = `${apiBase}/${fallbackModel}:generateContent`;

      const geminiMessages = toGeminiMessages(messages);

      const body: Record<string, any> = {
        contents: geminiMessages,
        generationConfig: {
          temperature: temperature ?? 0.2,
          maxOutputTokens: maxTokens ?? 8192,
        },
      };

      if (system) {
        body.systemInstruction = {
          parts: [{ text: system }],
        };
      }

      var controller = new AbortController();
      var timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      }
      try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
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
      return fromGeminiResponse(data);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
