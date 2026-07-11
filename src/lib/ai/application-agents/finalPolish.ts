// Final Polish agent — applies reviewer feedback and runs final QA.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "./types";
import { FinalResumeSchema, type FinalResumeV1 } from "./schemas";
import { buildFinalPolishPrompt } from "./prompts/finalPolish";
import { textOf } from "@/lib/ai/provider";

export async function runFinalPolish(
  _input: Record<string, never>,
  provider: AiProvider,
  ctx: AgentContext
): Promise<FinalResumeV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};
  const review = ctx.previousOutputs["application_hiring_panel"]?.data ?? {};

  const response = await provider.send({
    system: "You are Final Polish, an AI that applies reviewer feedback and produces a final resume. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildFinalPolishPrompt(ctx.job, ctx.baseResume, draft, review, jobAnalysis),
          },
        ],
      },
    ],
    tools: [],
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = FinalResumeSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Final Polish output validation failed: ${validated.error}`);
  return validated;
}
