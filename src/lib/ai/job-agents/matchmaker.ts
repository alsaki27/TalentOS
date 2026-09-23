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

  if (!stagedJob) return { matches: [] };

  var job = {
    title: stagedJob.title ?? "Unknown",
    company: stagedJob.company ?? "Unknown",
    location: stagedJob.location,
    descriptionText: stagedJob.description_text ?? "",
    requirements: deepFetchResult?.requirements ?? { yearsExperience: null, techStack: [], clearance: null, certifications: [] },
  };

  try {
    var response = await provider.send({
      system: options.system_prompt ?? "You are Matchmaker for TalentOS. Return only valid JSON.",
      messages: [
        { role: "user", content: [{ type: "text", text: buildMatchmakerPrompt(job, candidates) }] },
      ],
      tools: [],
      temperature: options.temperature ?? 0.1,
      maxTokens: options.max_output_tokens ?? 4096,
      timeoutMs: options.timeout_ms ?? 8000,
    });

    var parsed = parseAiJson(textOf(response.content));
    var validated = MatchmakerResultSchema.parse(parsed);
    if ("error" in validated) throw new Error("Matchmaker validation: " + validated.error);
    return validated;
  } catch (err) {
    console.warn("[Matchmaker] AI failed (" + ((err as Error).message ?? String(err)) + ") — returning empty matches");
    return { matches: [] };
  }
}

function parseAiJson(raw: string): unknown {
  var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(stripped);
}
