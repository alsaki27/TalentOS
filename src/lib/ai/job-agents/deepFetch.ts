import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext, StagedJob } from "./types";
import { DeepFetchResultSchema, type DeepFetchResultV1 } from "./schemas";
import { buildDeepFetchPrompt } from "./prompts/deepFetch";
import { fetchJobPageText, isSafeExternalUrl } from "./fetchJobPage";
import { textOf } from "@/lib/ai/provider";

function resolveFetchUrl(stagedJob: StagedJob): string | null {
  if (stagedJob.source_url && isSafeExternalUrl(stagedJob.source_url)) {
    return stagedJob.source_url;
  }
  if (stagedJob.raw && typeof stagedJob.raw === "object") {
    var raw = stagedJob.raw as Record<string, unknown>;
    if (raw.apply_url && typeof raw.apply_url === "string" && isSafeExternalUrl(raw.apply_url)) {
      return raw.apply_url;
    }
  }
  return null;
}

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

  if (existingDesc.length > 200) {
    return {
      descriptionText: existingDesc,
      requirements: stagedJob.requirements as DeepFetchResultV1["requirements"] ?? { yearsExperience: null, techStack: [], clearance: null, certifications: [] },
    };
  }

  var fetchUrl = resolveFetchUrl(stagedJob);

  if (!fetchUrl) {
    console.warn(`[Deep Fetch] No fetchable URL for: "${title}" @ "${company}"`);
    return { descriptionText: existingDesc, requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  var rawText = await fetchJobPageText(fetchUrl);

  if (!rawText) {
    console.warn(`[Deep Fetch] No description obtained for: "${title}" @ "${company}"`);
    return { descriptionText: existingDesc, requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  try {
    var response = await provider.send({
      system: options.system_prompt ?? "You are Deep Fetch, a job-description extraction agent. Return only valid JSON.",
      messages: [
        { role: "user", content: [{ type: "text", text: buildDeepFetchPrompt(title, company, rawText) }] },
      ],
      tools: [],
      temperature: options.temperature ?? 0.1,
      maxTokens: options.max_output_tokens ?? 2048,
      timeoutMs: options.timeout_ms ?? 8000,
    });

    var parsed = parseAiJson(textOf(response.content));
    var validated = DeepFetchResultSchema.parse(parsed);
    if ("error" in validated) throw new Error("Deep Fetch validation: " + validated.error);
    console.log(`[Deep Fetch] AI extracted description (${validated.descriptionText.length} chars) for: "${title}"`);
    return validated;
  } catch (err) {
    console.warn(`[Deep Fetch] AI extraction failed (${(err as Error).message ?? String(err)}) — using raw fetched text`);
    return {
      descriptionText: rawText,
      requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] },
    };
  }
}

function parseAiJson(raw: string): unknown {
  var stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(stripped);
}
