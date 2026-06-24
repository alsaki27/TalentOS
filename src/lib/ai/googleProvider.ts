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

export function getGoogleProvider(): AiProvider | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  return {
    async send({ system, messages }) {
      const model = process.env.GOOGLE_MODEL || DEFAULT_MODEL;
      const url = `${GOOGLE_API_BASE}/${model}:generateContent`;

      const geminiMessages = toGeminiMessages(messages);

      const body: Record<string, any> = {
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
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
      return fromGeminiResponse(data);
    },
  };
}

export function getGoogleFallbackProvider(): AiProvider | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  const fallbackModel = process.env.GOOGLE_FALLBACK_MODEL;
  if (!apiKey || !fallbackModel) return null;

  return {
    async send({ system, messages }) {
      const url = `${GOOGLE_API_BASE}/${fallbackModel}:generateContent`;

      const geminiMessages = toGeminiMessages(messages);

      const body: Record<string, any> = {
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
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
      return fromGeminiResponse(data);
    },
  };
}
