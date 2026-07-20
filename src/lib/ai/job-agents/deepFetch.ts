import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext, StagedJob } from "./types";
import { DeepFetchResultSchema, type DeepFetchResultV1 } from "./schemas";
import { buildDeepFetchPrompt } from "./prompts/deepFetch";
import { fetchJobPageText } from "./fetchJobPage";
import { textOf } from "@/lib/ai/provider";

export async function runDeepFetch(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  ctx: JobCeoAgentContext
): Promise<DeepFetchResultV1> {
  var stagedJob = ctx.previousOutputs.stagedJob as StagedJob | undefined;
  if (!stagedJob) {
    return { descriptionText: "", requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  var existingDesc = stagedJob.description_text ?? "";
  var title = stagedJob.title ?? "Unknown";
  var company = stagedJob.company ?? "Unknown";

  if (existingDesc.length > 500) {
    return {
      descriptionText: existingDesc,
      requirements: stagedJob.requirements as DeepFetchResultV1["requirements"] ?? { yearsExperience: null, techStack: [], clearance: null, certifications: [] },
    };
  }

  var rawText = "";
  if (stagedJob.source_url) {
    rawText = await fetchJobPageText(stagedJob.source_url);
  }

  if (!rawText && existingDesc.length < 50) {
    return { descriptionText: existingDesc, requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  var enrichedText = rawText ? rawText : existingDesc;

  try {
    var response = await provider.send({
      system: options.system_prompt ?? "You are Deep Fetch, a job-description enhancement agent. Return only valid JSON.",
      messages: [
        { role: "user", content: [{ type: "text", text: buildDeepFetchPrompt(title, company, enrichedText) }] },
      ],
      tools: [],
      temperature: options.temperature,
      maxTokens: options.max_output_tokens,
      timeoutMs: options.timeout_ms,
    });

    var raw = textOf(response.content);
    var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    var parsed = JSON.parse(stripped);
    var validated = DeepFetchResultSchema.parse(parsed);
    if ("error" in validated) throw new Error("Deep Fetch output validation failed: " + validated.error);

    return validated;
  } catch (err) {
    return { descriptionText: existingDesc, requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }
}
