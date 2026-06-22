// src/lib/ai/openAiCompatibleProvider.ts
// Shared request/response conversion for any provider that speaks the OpenAI
// chat-completions wire format (tool calls in a separate `tool_calls` array with
// stringified arguments, tool results as their own `role: "tool"` messages).
// NVIDIA, OpenAI itself, and GLM (Zhipu's open.bigmodel.cn endpoint) all use this
// exact shape - factored out here instead of tripling the same conversion logic
// across nvidiaProvider.ts/openaiProvider.ts/glmProvider.ts.

import { AiContentBlock, AiMessage, AiProvider, AiResponse, AiTool, textOf, toolUsesOf } from "@/lib/ai/provider";

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function toOpenAiMessages(messages: AiMessage[]): OpenAiMessage[] {
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

export function toOpenAiTools(tools: AiTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export function fromOpenAiChoice(choice: any): AiResponse {
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

export interface OpenAiCompatibleConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  errorLabel: string; // e.g. "OpenAI API", "GLM API" — used in thrown error messages
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AiProvider {
  return {
    async send({ system, messages, tools }) {
      const res = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...config.extraHeaders,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "system", content: system }, ...toOpenAiMessages(messages)],
          max_tokens: config.maxTokens ?? 4096,
          temperature: config.temperature ?? 0.4,
          stream: false,
          ...config.extraBody,
          ...(tools.length > 0 ? { tools: toOpenAiTools(tools) } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${config.errorLabel} error (${res.status}): ${body}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error(`${config.errorLabel} returned no choices.`);
      return fromOpenAiChoice(choice);
    },
  };
}
