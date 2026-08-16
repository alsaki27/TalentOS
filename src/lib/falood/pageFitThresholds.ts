// src/lib/falood/pageFitThresholds.ts
// Shared page-fit target thresholds and the pure mapper from real rendered-PDF
// metrics (ResumePageMetrics) to the AI pipeline's PageFitV1 recommendation -
// used by both Hiring Panel (advisory, pre-edit) and Final Polish (bounded
// edits, post-edit) so the two stages can never silently disagree about what
// "fits" means. Font-size floor is READABILITY_FLOOR_FONT_SIZE in
// skarionPdfDocument.tsx (also autoFit.ts's FLOORS.fontSize) - not redeclared
// here, so there's exactly one place that number can be changed.

import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";
import type { PageFitV1 } from "@/lib/ai/application-agents/schemas";

export const MIN_UTILIZATION = 0.82;
export const MAX_UTILIZATION = 0.97;

/** pageFit is never authored by the LLM - this is the one place real measured
 *  metrics become the pipeline's PageFitV1 recommendation. */
export function mapMetricsToPageFit(m: ResumePageMetrics | null): PageFitV1 | null {
  if (!m) return null;
  const recommendation: PageFitV1["recommendation"] =
    !m.readable ? "manual_review" :
    m.overflow ? "trim" :
    m.contentUtilization < MIN_UTILIZATION ? "expand" :
    m.contentUtilization > MAX_UTILIZATION ? "trim" :
    "pass";
  return { ...m, recommendation };
}
