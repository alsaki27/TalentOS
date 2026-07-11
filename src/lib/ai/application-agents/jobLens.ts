// Job Lens agent — analyzes the JD and extracts requirements.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "./types";
import { JobAnalysisSchema, type JobAnalysisV1 } from "./schemas";
import { buildJobLensPrompt } from "./prompts/jobLens";
import { textOf } from "@/lib/ai/provider";

export async function runJobLens(
  _input: Record<string, never>,
  provider: AiProvider,
  ctx: AgentContext
): Promise<JobAnalysisV1> {
  const response = await provider.send({
    system: "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildJobLensPrompt(ctx.job) }] },
    ],
    tools: [],
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = JobAnalysisSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Job Lens output validation failed: ${validated.error}`);
  return validated;
}
