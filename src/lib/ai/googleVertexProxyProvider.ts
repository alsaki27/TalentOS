// src/lib/ai/googleVertexProxyProvider.ts
// Google Vertex AI via Cloud Run proxy. No API key, no service account JSON.
// Uses GOOGLE_VERTEX_PROXY_URL + GOOGLE_VERTEX_PROXY_SECRET to call the proxy.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool } from "@/lib/ai/provider";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

function toVertexProxyMessages(messages: AiMessage[]): { role: string; content: string }[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") return `[Tool use: ${b.name}(${JSON.stringify(b.input)})]`;
      if (b.type === "tool_result") return `[Tool result: ${b.content}]`;
      return "";
    }).join("\n"),
  }));
}

export function getGoogleVertexProxyProvider(): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;

  if (!proxyUrl || !proxySecret) return null;

  return {
    async send({ system, messages, tools }) {
      const model = process.env.GOOGLE_VERTEX_MODEL || DEFAULT_MODEL;

      const res = await fetch(`${proxyUrl}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({
          system,
          messages: toVertexProxyMessages(messages),
          model,
          temperature: 0.2,
          maxOutputTokens: 2048,
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
      const text = data.text ?? "";

      return {
        content: [{ type: "text", text }],
        stopReason: "end_turn",
      };
    },
  };
}

export function getGoogleVertexFallbackProvider(): AiProvider | null {
  const proxyUrl = process.env.GOOGLE_VERTEX_PROXY_URL;
  const proxySecret = process.env.GOOGLE_VERTEX_PROXY_SECRET;
  const fallbackModel = process.env.GOOGLE_VERTEX_FALLBACK_MODEL;

  if (!proxyUrl || !proxySecret || !fallbackModel) return null;

  return {
    async send({ system, messages, tools }) {
      const res = await fetch(`${proxyUrl}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({
          system,
          messages: toVertexProxyMessages(messages),
          model: fallbackModel,
          temperature: 0.2,
          maxOutputTokens: 2048,
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
      const text = data.text ?? "";

      return {
        content: [{ type: "text", text }],
        stopReason: "end_turn",
      };
    },
  };
}
