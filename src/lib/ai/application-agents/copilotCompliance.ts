import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { CopilotComplianceSchema, type CopilotComplianceV1 } from "./schemas";
import { buildCopilotCompliancePrompt, type CopilotComplianceInputContext } from "./prompts/copilotCompliance";
import type { AgentOptions } from "./types";

export async function runCopilotCompliance(
  options: AgentOptions,
  provider: AiProvider,
  ctx: CopilotComplianceInputContext
): Promise<CopilotComplianceV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Compliance. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildCopilotCompliancePrompt(ctx) }] }],
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
    throw new Error(`Copilot Compliance returned invalid JSON: ${err}`);
  }

  const validated = CopilotComplianceSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Compliance output validation failed: ${validated.error}`);
  return validated;
}
