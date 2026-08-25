// Job Lens agent — analyzes the JD and extracts requirements.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { JobAnalysisSchema, type JobAnalysisV1 } from "./schemas";
import { buildJobLensPrompt, resolveJobDescription } from "./prompts/jobLens";
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

  // ROOT CAUSE #3 GUARD: if the job has no usable description, fail immediately
  // with a clear, actionable error rather than sending "No description available"
  // to the AI and burning an expensive call that returns empty/useless analysis.
  // That empty analysis then hard-fails the Hiring Panel quality gate (atsScore=0
  // against minimum_score=6.0) three stages later, wasting the full pipeline cost.
  // The error text is surfaced directly on the Application Queue page via
  // resume_generation_error so the operator knows exactly what to fix.
  const jobDescription = resolveJobDescription(ctx.job);
  if (!jobDescription || jobDescription === "No description available") {
    throw new Error(
      `Job Lens failed: no job description found for "${ctx.job?.title ?? ctx.job?.id ?? "this job"}". ` +
      `Add description text (description_text or notes) to the job posting and retry.`
    );
  }

  const response = await provider.send({
    system: options.system_prompt ?? "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildJobLensPrompt(ctx.job, {
              baseResume: ctx.baseResume,
              evidence: ctx.evidence,
              sourceOfTruth: ctx.sourceOfTruth,
              verifiedSkills: ctx.verifiedSkills,
            }),
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

  // ROOT CAUSE #2 FIX: robustly extract the JSON object from the provider response.
  // Some providers (especially when they switch from a failed primary key to a
  // fallback model) return markdown fences, a preamble like "Here is the analysis:",
  // or trailing commentary after the JSON. A simple regex fence-strip only removes
  // the outermost backtick block — it fails if there is ANY text before the first "{".
  // Find the outermost JSON object boundaries instead so parsing always succeeds.
  let stripped = raw.trim();
  // Step 1: strip markdown fences if they wrap the entire response
  stripped = stripped.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Step 2: find the first '{' and last '}' to extract just the JSON object,
  // ignoring any surrounding narrative text the provider added.
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    stripped = stripped.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(stripped);

  // The job record is authoritative for identity. A provider occasionally
  // omits title/company while still returning valid requirement analysis;
  // treating that omission as a fatal workflow error wastes the entire run.
  // Fill only identity fields from the stored job and leave all analytical
  // fields provider-generated so we never invent requirements.
  const canonicalTitle = typeof ctx.job?.title === "string" && ctx.job.title.trim()
    ? ctx.job.title.trim()
    : (typeof (ctx.job as any)?.job_title === "string" ? (ctx.job as any).job_title.trim() : "");
  const canonicalCompany = typeof ctx.job?.company === "string" && ctx.job.company.trim()
    ? ctx.job.company.trim()
    : (typeof (ctx.job as any)?.company_name === "string" ? (ctx.job as any).company_name.trim() : "Unknown company");
  const normalized = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? {
      ...(parsed as Record<string, unknown>),
      title: typeof (parsed as any).title === "string" && (parsed as any).title.trim()
        ? (parsed as any).title
        : canonicalTitle,
      company: typeof (parsed as any).company === "string" && (parsed as any).company.trim()
        ? (parsed as any).company
        : canonicalCompany,
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
