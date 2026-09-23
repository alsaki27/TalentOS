import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext } from "./types";
import { ScoutTermsSchema, type ScoutTermsV1 } from "./schemas";
import { buildQueryScoutPrompt } from "./prompts/queryScout";
import { textOf } from "@/lib/ai/provider";

export interface QueryScoutInput {
  roleLibrary: string[];
  recentMatchStats?: string;
}

export async function runQueryScout(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  _ctx: JobCeoAgentContext
): Promise<ScoutTermsV1> {
  var input: QueryScoutInput = (_ctx.previousOutputs as any)?.scoutInput ?? { roleLibrary: ["OSP Engineer", "Fiber Designer", "Telecom Drafter", "GIS Analyst"] };
  if ((_ctx.previousOutputs as any)?.roleLibrary) {
    input.roleLibrary = (_ctx.previousOutputs as any).roleLibrary;
  }
  if ((_ctx.previousOutputs as any)?.recentMatchStats) {
    input.recentMatchStats = (_ctx.previousOutputs as any).recentMatchStats;
  }

  var response = await provider.send({
    system: options.system_prompt ?? "You are Query Scout, a job-search term formulator. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildQueryScoutPrompt(input.roleLibrary, input.recentMatchStats) }] },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  var raw = textOf(response.content);
  var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  var parsed = JSON.parse(stripped);
  var validated = ScoutTermsSchema.parse(parsed);
  if ("error" in validated) throw new Error("Query Scout output validation failed: " + validated.error);

  return validated;
}
