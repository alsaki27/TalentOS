import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { CopilotFormAnalystSchema, type CopilotFormAnalystV1 } from "./schemas";
import { buildCopilotFormAnalystPrompt, type CopilotFormAnalystInputContext } from "./prompts/copilotFormAnalyst";
import type { AgentOptions } from "./types";

export async function runCopilotFormAnalyst(
  options: AgentOptions,
  provider: AiProvider,
  ctx: CopilotFormAnalystInputContext
): Promise<CopilotFormAnalystV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Form Analyst. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildCopilotFormAnalystPrompt(ctx) }] }],
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
    throw new Error(`Copilot Form Analyst returned invalid JSON: ${err}`);
  }

  const validated = CopilotFormAnalystSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Form Analyst output validation failed: ${validated.error}`);
  return validated;
}
