// Resume Forge agent — produces an evidence-supported tailored draft.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { ResumeDraftSchema, type ResumeDraftV1 } from "./schemas";
import { buildResumeForgePrompt } from "./prompts/resumeForge";
import { textOf } from "@/lib/ai/provider";

export async function runResumeForge(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ResumeDraftV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};

  const response = await provider.send({
    system: options.system_prompt ?? "You are Resume Forge, an AI that tailors resumes using only supported evidence. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildResumeForgePrompt(ctx.job, ctx.baseResume, ctx.evidence, jobAnalysis),
          },
        ],
      },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = ResumeDraftSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Resume Forge output validation failed: ${validated.error}`);
  return validated;
}
