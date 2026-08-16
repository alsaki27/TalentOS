// Hiring Panel agent — grades the tailored draft as recruiter, HR, and ATS.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { ReviewScoreSchema, type ReviewScoreV1 } from "./schemas";
import { buildHiringPanelPrompt } from "./prompts/hiringPanel";
import { textOf } from "@/lib/ai/provider";
import { finalResumeToStudioDocument, type RenderableResumeContent } from "./finalResumeToStudioDocument";
import { renderResumePdfWithMetrics, type ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import { mapMetricsToPageFit } from "@/lib/falood/pageFitThresholds";

// Renders Resume Forge's draft through the same PDF renderer the actual
// export/Final-Polish path uses, so Hiring Panel's page-fit numbers are real,
// not guessed. Must never throw - a rendering failure (malformed draft,
// missing base-resume content) degrades to no metrics rather than failing
// the whole workflow stage.
function renderDraftMetrics(draft: RenderableResumeContent, baseContent: any): ResumePageMetrics | null {
  try {
    const studioDoc = finalResumeToStudioDocument(draft, baseContent ?? {});
    return renderResumePdfWithMetrics(normalizeResumeContentForExport(studioDoc)).metrics;
  } catch (err) {
    console.warn("[Agent:HiringPanel] Page-fit rendering failed, proceeding without metrics:", (err as Error)?.message);
    return null;
  }
}

export async function runHiringPanel(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ReviewScoreV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};

  const pageMetrics = renderDraftMetrics(draft as RenderableResumeContent, (ctx.baseResume as any)?.content);

  // ── DEBUG: Hiring Panel ──────────────────────────────────────────
  console.log("[Agent:HiringPanel] ── INPUT ────────────────────────────────────");
  console.log("[Agent:HiringPanel] jobAnalysis (from JobLens):", JSON.stringify(jobAnalysis, null, 2));
  console.log("[Agent:HiringPanel] draft (from ResumeForge):", JSON.stringify(draft, null, 2));
  console.log("[Agent:HiringPanel] pageMetrics (measured):", JSON.stringify(pageMetrics, null, 2));
  console.log("[Agent:HiringPanel] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  const response = await provider.send({
    system: options.system_prompt ?? "You are Hiring Panel, an AI that grades resumes. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildHiringPanelPrompt(ctx.job, ctx.baseResume, draft, jobAnalysis, ctx.sourceOfTruth, ctx.evidence, pageMetrics),
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
  const validated = ReviewScoreSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Hiring Panel output validation failed: ${validated.error}`);
  validated.pageFit = mapMetricsToPageFit(pageMetrics);

  // ── DEBUG: Hiring Panel ──────────────────────────────────────────
  console.log("[Agent:HiringPanel] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:HiringPanel] validated review:", JSON.stringify(validated, null, 2));
  console.log("[Agent:HiringPanel] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return validated;
}
