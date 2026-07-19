import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { CopilotAnswerSchema, type CopilotAnswerV1 } from "./schemas";
import { buildCopilotAnswerQuestionPrompt, type CopilotAnswerQuestionInputContext } from "./prompts/copilotAnswerQuestion";
import { textOf } from "@/lib/ai/provider";

export async function runCopilotAnswerQuestion(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext & { question: string; fieldContext: string; maxLength: number }
): Promise<CopilotAnswerV1> {
  const inputContext: CopilotAnswerQuestionInputContext = {
    question: ctx.question,
    fieldContext: ctx.fieldContext,
    maxLength: ctx.maxLength || 500,
    candidateProfile: {
      name: (ctx as any).candidateProfile?.name || "Unknown Candidate",
      verifiedSkills: ctx.verifiedSkills || [],
    },
    resumeText: typeof ctx.baseResume.content === "string" ? ctx.baseResume.content : JSON.stringify(ctx.baseResume.content),
    evidenceText: ctx.evidence ? ctx.evidence.map(e => `${e.title}: ${e.description}`).join('\n') : "",
    jobTitle: ctx.job.title,
    company: ctx.job.company || "Unknown Company",
  };

  const response = await provider.send({
    system: options.system_prompt ?? "You are Copilot Question Answerer. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildCopilotAnswerQuestionPrompt(inputContext) }] },
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
    throw new Error(`Copilot Answer Question agent returned invalid JSON: ${err}`);
  }

  const validated = CopilotAnswerSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Copilot Answer Question output validation failed: ${validated.error}`);

  return validated;
}
