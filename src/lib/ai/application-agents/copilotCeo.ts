import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { CopilotCeoReviewSchema, type CopilotCeoReviewV1 } from "./schemas";
import { buildCopilotCeoPrompt, type CopilotCeoInputContext } from "./prompts/copilotCeo";
import type { AgentOptions } from "./types";

export async function runCopilotCeo(
  options: AgentOptions,
  provider: AiProvider,
  ctx: CopilotCeoInputContext
): Promise<CopilotCeoReviewV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot CEO. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildCopilotCeoPrompt(ctx) }] }],
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
    throw new Error(`Copilot CEO returned invalid JSON: ${err}`);
  }

  const validated = CopilotCeoReviewSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot CEO output validation failed: ${validated.error}`);
  return validated;
}
