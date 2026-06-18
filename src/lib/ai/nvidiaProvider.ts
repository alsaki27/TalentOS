// src/lib/ai/nvidiaProvider.ts
// NVIDIA's hosted inference API (integrate.api.nvidia.com) speaks OpenAI-compatible
// chat completions, which shapes tool-calling differently than Anthropic's Messages
// API: tool calls live in a separate `tool_calls` array (arguments as a JSON
// *string*, not an object), and tool results are their own `role: "tool"` messages
// rather than blocks nested in a user turn. This file's job is bridging that into
// the same AiProvider interface anthropicProvider.ts implements, so the rest of the
// app (src/app/api/chat/route.ts, the tool executor) never needs to know which
// provider is active.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool, textOf, toolUsesOf } from "@/lib/ai/provider";

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "moonshotai/kimi-k2.6";
const MAX_TOKENS = 4096;

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOpenAiMessages(messages: AiMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];

  for (const m of messages) {
    const toolResults = m.content.filter((b) => b.type === "tool_result") as
      { type: "tool_result"; toolUseId: string; content: string }[];

    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({ role: "tool", tool_call_id: tr.toolUseId, content: tr.content });
      }
      continue;
    }

    if (m.role === "assistant") {
      const text = textOf(m.content);
      const toolUses = toolUsesOf(m.content);
      const message: OpenAiMessage = { role: "assistant", content: text || null };
      if (toolUses.length > 0) {
        message.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        }));
      }
      out.push(message);
    } else {
      out.push({ role: "user", content: textOf(m.content) });
    }
  }

  return out;
}

function toOpenAiTools(tools: AiTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

function fromOpenAiChoice(choice: any): AiResponse {
  const message = choice.message ?? {};
  const content: AiContentBlock[] = [];

  if (message.content) content.push({ type: "text", text: message.content });

  for (const call of message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(call.function.arguments || "{}"); } catch { /* malformed args from the model — treat as empty input */ }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }

  const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn";
  return { content, stopReason };
}

export function getNvidiaProvider(): AiProvider | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  return {
    async send({ system, messages, tools }) {
      const res = await fetch(NVIDIA_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
          messages: [{ role: "system", content: system }, ...toOpenAiMessages(messages)],
          max_tokens: MAX_TOKENS,
          temperature: 0.4,
          top_p: 1,
          // Without these, this model reliably degenerates into repeating itself verbatim
          // after receiving a tool result (confirmed live: finish_reason "repetition") —
          // not a hypothetical, this reproduced on the first round-trip tool-result test.
          frequency_penalty: 0.6,
          presence_penalty: 0.4,
          stream: false,
          ...(tools.length > 0 ? { tools: toOpenAiTools(tools) } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`NVIDIA API error (${res.status}): ${body}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error("NVIDIA API returned no choices.");
      return fromOpenAiChoice(choice);
    },
  };
}
