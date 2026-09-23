// OpenAI Responses API transport used by OpenCode models that are not served
// through the Chat Completions endpoint. OpenCode Go currently documents
// GPT-5.6 Luna on /responses; its other Go models remain on the existing
// OpenAI-compatible /chat/completions transport.

import {
  AiContentBlock,
  AiMessage,
  AiProvider,
  AiResponse,
  AiTool,
  textOf,
  toolUsesOf,
} from "@/lib/ai/provider";

type ResponsesInputItem = Record<string, unknown>;

function toResponsesInput(system: string, messages: AiMessage[]): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  if (system) {
    input.push({
      role: "system",
      content: [{ type: "input_text", text: system }],
    });
  }

  for (const message of messages) {
    const toolResults = message.content.filter((block) => block.type === "tool_result") as {
      type: "tool_result";
      toolUseId: string;
      content: string;
    }[];

    if (toolResults.length > 0) {
      for (const result of toolResults) {
        input.push({
          type: "function_call_output",
          call_id: result.toolUseId,
          output: result.content,
        });
      }
      continue;
    }

    const text = textOf(message.content);
    const toolUses = toolUsesOf(message.content);

    if (message.role === "assistant") {
      if (text) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      for (const toolUse of toolUses) {
        input.push({
          type: "function_call",
          call_id: toolUse.id,
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input),
        });
      }
      continue;
    }

    input.push({
      role: "user",
      content: [{ type: "input_text", text }],
    });
  }

  return input;
}

function toResponsesTools(tools: AiTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}

function parseFunctionArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return (value as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export function fromResponsesOutput(data: any): AiResponse {
  const content: AiContentBlock[] = [];

  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const block of item.content ?? []) {
        if (block.type === "output_text" && block.text) {
          content.push({ type: "text", text: block.text });
        }
      }
    } else if (item.type === "function_call") {
      content.push({
        type: "tool_use",
        id: item.call_id ?? item.id,
        name: item.name,
        input: parseFunctionArguments(item.arguments),
      });
    }
  }

  const incompleteReason = data.incomplete_details?.reason;
  const stopReason = incompleteReason === "max_output_tokens"
    ? "max_tokens"
    : content.some((block) => block.type === "tool_use")
      ? "tool_use"
      : data.status === "incomplete"
        ? incompleteReason ?? "incomplete"
        : "end_turn";

  return {
    content,
    stopReason,
    usage: data.usage
      ? {
          input_tokens: data.usage.input_tokens ?? 0,
          output_tokens: data.usage.output_tokens ?? 0,
        }
      : undefined,
  };
}

export interface OpenAiResponsesConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  errorLabel: string;
}

export function createOpenAiResponsesProvider(config: OpenAiResponsesConfig): AiProvider {
  return {
    async send({ system, messages, tools, maxTokens, timeoutMs }) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }

      try {
        const body: Record<string, unknown> = {
          model: config.model,
          input: toResponsesInput(system, messages),
          max_output_tokens: maxTokens ?? config.maxOutputTokens ?? 8192,
          // GPT-5.6 Luna's Responses endpoint uses its documented default;
          // sending the lower agent temperatures used by Chat Completions
          // produces a provider-side 400.
          stream: false,
        };
        if (tools.length > 0) body.tools = toResponsesTools(tools);

        const response = await fetch(config.apiUrl, {
          signal: controller.signal,
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const responseBody = await response.text();
          throw new Error(`${config.errorLabel} error (${response.status}): ${responseBody}`);
        }

        return fromResponsesOutput(await response.json());
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
