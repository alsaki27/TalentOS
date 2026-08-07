import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { CopilotCorrectionReviewSchema, type CopilotCorrectionReviewV1 } from "./schemas";
import { buildCopilotCorrectionReviewerPrompt, type CopilotCorrectionReviewInputContext } from "./prompts/copilotCorrectionReviewer";
import type { AgentOptions } from "./types";

export async function runCopilotCorrectionReviewer(
  options: AgentOptions,
  provider: AiProvider,
  ctx: CopilotCorrectionReviewInputContext
): Promise<CopilotCorrectionReviewV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Correction Reviewer. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildCopilotCorrectionReviewerPrompt(ctx) }] }],
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
    throw new Error(`Copilot Correction Reviewer returned invalid JSON: ${err}`);
  }

  const validated = CopilotCorrectionReviewSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Correction Reviewer output validation failed: ${validated.error}`);
  return validated;
}
