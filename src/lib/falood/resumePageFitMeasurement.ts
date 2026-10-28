// src/lib/falood/resumePageFitMeasurement.ts
// Recomputes page_fit_metrics from resume content whenever content changes
// outside the AI pipeline's own finalization run (manual AE edits saved from
// Falood Studio, suggestion-apply flows) - otherwise the stored metrics stay
// pinned to whatever the content measured as before the edit, which is how
// the Application Queue's overflow badge went stale after an AE had already
// fixed a resume down to one page.
//
// Same deterministic, non-AI pipeline already used server-side by
// hiringPanel.ts/finalPolish.ts and client-side by the Falood Studio toolbar
// badge - pageFit is never authored by the LLM (see pageFitThresholds.ts).

import { renderResumePdfWithMetrics } from "@/lib/falood/skarionPdfDocument";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import { mapMetricsToPageFit } from "@/lib/falood/pageFitThresholds";

// Returns undefined (not null) when measurement can't be performed, so
// callers can tell "leave the stored value alone" apart from "measured
// successfully and there's genuinely nothing to show" - a render failure on
// odd/legacy content should never erase a previously-good stored value.
export function measureResumePageFitMetrics(content: unknown): Record<string, unknown> | undefined {
  if (!content || typeof content !== "object") return undefined;
  try {
    const { metrics } = renderResumePdfWithMetrics(normalizeResumeContentForExport(content));
    const pageFit = mapMetricsToPageFit(metrics);
    return pageFit ? (pageFit as unknown as Record<string, unknown>) : undefined;
  } catch (err) {
    console.warn("[resumePageFitMeasurement] Page-fit rendering failed, leaving stored metrics unchanged:", (err as Error)?.message);
    return undefined;
  }
}
