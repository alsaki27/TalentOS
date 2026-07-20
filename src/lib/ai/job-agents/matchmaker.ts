import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext, StagedJob } from "./types";
import { MatchmakerResultSchema, type MatchmakerResultV1 } from "./schemas";
import type { DeepFetchResultV1 } from "./schemas";
import { buildMatchmakerPrompt, type CandidateSummary } from "./prompts/matchmaker";
import { textOf } from "@/lib/ai/provider";

export async function runMatchmaker(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  ctx: JobCeoAgentContext
): Promise<MatchmakerResultV1> {
  var stagedJob = ctx.previousOutputs.stagedJob as StagedJob | undefined;
  var candidates = (ctx.previousOutputs.candidateSummaries as CandidateSummary[]) ?? [];
  var deepFetchResult = ctx.previousOutputs.deepFetchResult as DeepFetchResultV1 | undefined;

  if (!stagedJob) {
    return { matches: [] };
  }

  var job = {
    title: stagedJob.title ?? "Unknown",
    company: stagedJob.company ?? "Unknown",
    location: stagedJob.location,
    descriptionText: stagedJob.description_text ?? "",
    requirements: deepFetchResult?.requirements ?? { yearsExperience: null, techStack: [], clearance: null, certifications: [] },
  };

  try {
    var response = await provider.send({
      system: options.system_prompt ?? "You are Matchmaker, a candidate-job matching agent for TalentOS. Return only valid JSON.",
      messages: [
        { role: "user", content: [{ type: "text", text: buildMatchmakerPrompt(job, candidates) }] },
      ],
      tools: [],
      temperature: options.temperature,
      maxTokens: options.max_output_tokens,
      timeoutMs: options.timeout_ms,
    });

    var raw = textOf(response.content);
    var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    var parsed = JSON.parse(stripped);
    var validated = MatchmakerResultSchema.parse(parsed);
    if ("error" in validated) throw new Error("Matchmaker output validation failed: " + validated.error);

    return validated;
  } catch (err) {
    return { matches: [] };
  }
}
