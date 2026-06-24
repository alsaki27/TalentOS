// src/lib/ai/anthropicProvider.ts
// Anthropic Messages API via raw fetch — no SDK dependency, consistent with how
// every other external integration in this app (ATS fetchers, USAJobs, career-page
// extractor) talks to its provider. Requires ANTHROPIC_API_KEY.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool } from "@/lib/ai/provider";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

function toAnthropicContent(content: AiContentBlock[]): unknown[] {
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    return { type: "tool_result", tool_use_id: block.toolUseId, content: block.content, is_error: block.isError ?? false };
  });
}

function fromAnthropicContent(content: any[]): AiContentBlock[] {
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    return { type: "text", text: JSON.stringify(block) };
  });
}

export function getAnthropicProvider(): AiProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return {
    async send({ system, messages, tools }) {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
          tools: tools.map((t): unknown => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic API error (${res.status}): ${body}`);
      }

      const data = await res.json();
      const response: AiResponse = {
        content: fromAnthropicContent(data.content ?? []),
        stopReason: data.stop_reason ?? "end_turn",
      };
      return response;
    },
  };
}
