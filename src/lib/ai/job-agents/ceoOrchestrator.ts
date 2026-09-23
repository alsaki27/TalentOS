import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext } from "./types";
import { CeoPlanSchema, type CeoPlanV1 } from "./schemas";
import { buildCeoPrompt } from "./prompts/ceoOrchestrator";
import { textOf } from "@/lib/ai/provider";

export async function runCeoOrchestrator(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  ctx: JobCeoAgentContext
): Promise<CeoPlanV1> {
  var runContext = (ctx.previousOutputs.runContext as Record<string, unknown>) ?? {};
  var agentConfigsSnapshot = (ctx.previousOutputs.agentConfigsSnapshot as Record<string, unknown>) ?? {};

  var response = await provider.send({
    system: options.system_prompt ?? "You are the JOB CEO, the orchestrator agent for TalentOS. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildCeoPrompt(runContext, agentConfigsSnapshot as any) }] },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  var raw = textOf(response.content);
  var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  var parsed = JSON.parse(stripped);
  var validated = CeoPlanSchema.parse(parsed);
  if ("error" in validated) throw new Error("CEO Orchestrator output validation failed: " + validated.error);

  return validated;
}
