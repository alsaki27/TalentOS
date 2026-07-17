// Description Enricher — unlike Deep Fetch (which only ever touches
// job_ceo_staging rows, once, before a job is first logged), this operates
// on the live `jobs` table on an ongoing cron, backfilling any job (from
// any source — OpenJobData, Apify, CSV import, manual) that still has a
// thin/missing description_text but a URL to retry.
import type { AiProvider } from "@/lib/ai/provider";
import { textOf } from "@/lib/ai/provider";
import { DeepFetchResultSchema, type DeepFetchResultV1 } from "./schemas";
import { buildDeepFetchPrompt } from "./prompts/deepFetch";
import { fetchJobPageText } from "./fetchJobPage";

export interface EnrichableJob {
  id: string;
  title: string | null;
  company: string | null;
  source_url: string | null;
  apply_url: string | null;
  description_text: string | null;
}

export async function runEnricher(
  options: { system_prompt?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number },
  provider: AiProvider,
  job: EnrichableJob
): Promise<DeepFetchResultV1> {
  var title = job.title ?? "Unknown";
  var company = job.company ?? "Unknown";
  var url = job.source_url || job.apply_url;

  if (!url) {
    return { descriptionText: job.description_text ?? "", requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  var rawText = await fetchJobPageText(url);
  if (!rawText) {
    return { descriptionText: job.description_text ?? "", requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }

  try {
    var response = await provider.send({
      system: options.system_prompt ?? "You are Description Enricher, a job-description backfill agent. Return only valid JSON.",
      messages: [
        { role: "user", content: [{ type: "text", text: buildDeepFetchPrompt(title, company, rawText) }] },
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
    if ("error" in validated) throw new Error("Enricher output validation failed: " + validated.error);

    return validated;
  } catch (_err) {
    return { descriptionText: job.description_text ?? "", requirements: { yearsExperience: null, techStack: [], clearance: null, certifications: [] } };
  }
}
