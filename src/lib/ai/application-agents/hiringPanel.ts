// Hiring Panel agent — grades the tailored draft as recruiter, HR, and ATS.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "./types";
import { ReviewScoreSchema, type ReviewScoreV1 } from "./schemas";
import { buildHiringPanelPrompt } from "./prompts/hiringPanel";
import { textOf } from "@/lib/ai/provider";

export async function runHiringPanel(
  _input: Record<string, never>,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ReviewScoreV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};

  const response = await provider.send({
    system: "You are Hiring Panel, an AI that grades resumes. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildHiringPanelPrompt(ctx.job, ctx.baseResume, draft, jobAnalysis),
          },
        ],
      },
    ],
    tools: [],
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = ReviewScoreSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Hiring Panel output validation failed: ${validated.error}`);
  return validated;
}
