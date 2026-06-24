// src/lib/ai/provider.ts
// Provider-agnostic types for the chat assistant, per the original vision doc's
// "provider abstraction — AI owns reasoning, app owns workflow" principle (see
// ROADMAP.md). One real implementation exists today (Anthropic, in
// anthropicProvider.ts); adding OpenAI/Gemini/Ollama later means implementing this
// same interface, not restructuring the app code that calls it.

export interface AiTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema for the tool's input
}

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: "user" | "assistant";
  content: AiContentBlock[];
}

export interface AiResponse {
  content: AiContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | string;
}

export interface AiProvider {
  send(opts: { system: string; messages: AiMessage[]; tools: AiTool[] }): Promise<AiResponse>;
}

export function textOf(content: AiContentBlock[]): string {
  return content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
}

export function toolUsesOf(content: AiContentBlock[]) {
  return content.filter((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use");
}

// Some models/providers (confirmed live: a NVIDIA-hosted model degenerating into
// repeated tokens after consuming a tool result — finish_reason "repetition") can return
// text that's technically well-formed but useless. A low unique-word ratio over a long
// enough sample is a cheap, reliable enough signal to catch it without false-positiving
// on normal short or naturally repetitive answers (e.g. "no, no candidates match that").
export function looksDegenerate(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  const unique = new Set(words.map((w) => w.toLowerCase()));
  return unique.size / words.length < 0.35;
}
