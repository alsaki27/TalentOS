// Job Lens agent — analyzes the JD and extracts requirements.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { JobAnalysisSchema, type JobAnalysisV1 } from "./schemas";
import { buildJobLensPrompt } from "./prompts/jobLens";
import { textOf } from "@/lib/ai/provider";

export async function runJobLens(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<JobAnalysisV1> {
  // ── DEBUG: Job Lens ─────────────────────────────────────────────
  console.log("[Agent:JobLens] ── INPUT ──────────────────────────────────────");
  console.log("[Agent:JobLens] job:", JSON.stringify(ctx.job, null, 2));
  console.log("[Agent:JobLens] ────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  const response = await provider.send({
    system: options.system_prompt ?? "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [
      { role: "user", content: [{ type: "text", text: buildJobLensPrompt(ctx.job) }] },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  // The job record is authoritative for identity. A provider occasionally
  // omits title/company while still returning valid requirement analysis;
  // treating that omission as a fatal workflow error wastes the entire run.
  // Fill only identity fields from the stored job and leave all analytical
  // fields provider-generated so we never invent requirements.
  const normalized = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? {
        ...(parsed as Record<string, unknown>),
        title: typeof (parsed as any).title === "string" && (parsed as any).title.trim()
          ? (parsed as any).title
          : (typeof ctx.job?.title === "string" ? ctx.job.title : ""),
        company: typeof (parsed as any).company === "string" && (parsed as any).company.trim()
          ? (parsed as any).company
          : (typeof ctx.job?.company === "string" ? ctx.job.company : "Unknown company"),
      }
    : parsed;
  const validated = JobAnalysisSchema.parse(normalized);
  if ("error" in validated) throw new Error(`Job Lens output validation failed: ${validated.error}`);

  // ── DEBUG: Job Lens ─────────────────────────────────────────────
  console.log("[Agent:JobLens] ── OUTPUT ─────────────────────────────────────");
  console.log("[Agent:JobLens] validated output:", JSON.stringify(validated, null, 2));
  console.log("[Agent:JobLens] ────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return validated;
}
