// Final Polish agent — applies reviewer feedback and runs final QA.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { FinalResumeSchema, type FinalResumeV1 } from "./schemas";
import { buildFinalPolishPrompt } from "./prompts/finalPolish";
import { textOf } from "@/lib/ai/provider";

export async function runFinalPolish(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<FinalResumeV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};
  const review = ctx.previousOutputs["application_hiring_panel"]?.data ?? {};

  const response = await provider.send({
    system: options.system_prompt ?? "You are Final Polish, an AI that applies reviewer feedback and produces a final resume. Return only valid JSON.",
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
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = FinalResumeSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Final Polish output validation failed: ${validated.error}`);

  // Defense in depth against the exact failure the prompt now explicitly
  // forbids: confirmed live, the model can satisfy the single-page word
  // count by wiping every bullet from a kept role (empty bullets array),
  // or even wiping the entire experience section to [], while still
  // setting exportReady: true and a high finalQaScore - a schema-valid but
  // practically broken resume (confirmed live: a real draft with 2 roles
  // and real bullets came out with experience: [] and exportReady: true).
  // Force a retry rather than let a gutted resume through, since the
  // prompt instruction alone isn't a guarantee.
  const draftHadExperience = Array.isArray((draft as any)?.experience) && (draft as any).experience.length > 0;
  const draftHadBullets = draftHadExperience && (draft as any).experience.some((e: any) => Array.isArray(e?.bullets) && e.bullets.length > 0);
  const emptyBulletRoles = validated.experience.filter((e) => e.bullets.length === 0);

  if (draftHadExperience && validated.experience.length === 0 && validated.exportReady) {
    throw new Error(
      `Final Polish wiped the entire experience section (draft had ${(draft as any).experience.length} role(s)) while marking exportReady - rejecting`
    );
  }
  if (draftHadBullets && emptyBulletRoles.length > 0 && validated.exportReady) {
    throw new Error(
      `Final Polish left ${emptyBulletRoles.length} kept role(s) with zero bullets while marking exportReady - rejecting: ${emptyBulletRoles.map((e) => e.title).join(", ")}`
    );
  }

  return validated;
}
