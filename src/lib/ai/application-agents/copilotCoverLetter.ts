import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { CopilotCoverLetterSchema, type CopilotCoverLetterV1 } from "./schemas";
import { buildCopilotCoverLetterPrompt, type CopilotCoverLetterInputContext } from "./prompts/copilotCoverLetter";
import type { AgentOptions } from "./types";

export async function runCopilotCoverLetter(
  options: AgentOptions,
  provider: AiProvider,
  ctx: CopilotCoverLetterInputContext
): Promise<CopilotCoverLetterV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Cover Letter. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildCopilotCoverLetterPrompt(ctx) }] }],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Copilot Cover Letter returned invalid JSON: ${err}`);
  }

  const validated = CopilotCoverLetterSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Cover Letter output validation failed: ${validated.error}`);
  return validated;
}
