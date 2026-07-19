import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { CopilotFillPlanSchema, type CopilotFillPlanV1 } from "./schemas";
import { buildCopilotFillerPrompt, type CopilotFillerInputContext } from "./prompts/copilotFiller";
import { textOf } from "@/lib/ai/provider";

export async function runCopilotFiller(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext & { formFields: any[] } // Extended context for this specific agent
): Promise<CopilotFillPlanV1> {
  const inputContext: CopilotFillerInputContext = {
    formFields: ctx.formFields,
    candidateProfile: {
      name: (ctx as any).candidateProfile?.name || "Unknown Candidate",
      email: (ctx as any).candidateProfile?.email || "",
      phone: (ctx as any).candidateProfile?.phone || "",
      location: (ctx as any).candidateProfile?.location || "",
      linkedin: (ctx as any).candidateProfile?.linkedin || "",
      portfolio: (ctx as any).candidateProfile?.portfolio || "",
      workAuthorization: (ctx as any).candidateProfile?.workAuthorization || "",
      salaryExpectation: (ctx as any).candidateProfile?.salaryExpectation || "",
      noticePeriod: (ctx as any).candidateProfile?.noticePeriod || "",
      verifiedSkills: ctx.verifiedSkills,
      targetRoles: (ctx as any).candidateProfile?.targetRoles || [],
    },
    resumeText: typeof ctx.baseResume.content === "string" ? ctx.baseResume.content : JSON.stringify(ctx.baseResume.content),
    jobTitle: ctx.job.title,
    company: ctx.job.company || "Unknown Company",
    jdText: ctx.job.description || ctx.job.rawDescription || "",
  };

  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Fill Planner. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildCopilotFillerPrompt(inputContext) }] },
    ],
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
    throw new Error(`Copilot Filler agent returned invalid JSON: ${err}`);
  }

  const validated = CopilotFillPlanSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Filler output validation failed: ${validated.error}`);

  return validated;
}
