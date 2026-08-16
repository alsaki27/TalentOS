// src/lib/falood/autoFit.ts
// One-page auto-fit engine. Applies a set of ordered, formatting-only rules,
// re-measuring the ACTUAL rendered PDF (via renderResumePdfWithMetrics, not a
// text-length guess) after each step and stopping as soon as it fits. Only
// formatting is ever adjusted automatically — rules that would touch resume
// CONTENT (shortening/merging/removing bullets) are deliberately not
// auto-applied here, matching "never silently delete important content."
// Content-level trimming lives in finalPolish.ts's bounded, code-enforced
// deterministic trim instead, which runs inside the AI pipeline where the
// job's keyword list is available to judge what's safe to shorten.

import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";
import { renderResumePdfWithMetrics, READABILITY_FLOOR_FONT_SIZE, type ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";

function measurePages(content: ResumeDocument): number {
  const { metrics } = renderResumePdfWithMetrics(normalizeResumeContentForExport(content));
  return metrics.pageCount;
}

export const FLOORS = {
  sectionSpacing: 2,
  bulletSpacing: 0,
  marginTop: 0.3,
  marginRight: 0.3,
  marginBottom: 0.3,
  marginLeft: 0.3,
  fontSize: READABILITY_FLOOR_FONT_SIZE,
  lineHeight: 1.0,
};

type FormattingStep = { label: string; apply: (f: ResumeFormatting) => ResumeFormatting };

const STEPS: FormattingStep[] = [
  {
    label: "Reduce section spacing",
    apply: (f) => ({ ...f, sectionSpacing: Math.max(FLOORS.sectionSpacing, f.sectionSpacing - 2) }),
  },
  {
    label: "Reduce bullet spacing",
    apply: (f) => ({ ...f, bulletSpacing: Math.max(FLOORS.bulletSpacing, f.bulletSpacing - 1) }),
  },
  {
    label: "Reduce margins",
    apply: (f) => ({
      ...f,
      marginTop: Math.max(FLOORS.marginTop, f.marginTop - 0.2),
      marginRight: Math.max(FLOORS.marginRight, f.marginRight - 0.2),
      marginBottom: Math.max(FLOORS.marginBottom, f.marginBottom - 0.2),
      marginLeft: Math.max(FLOORS.marginLeft, f.marginLeft - 0.2),
    }),
  },
  {
    // Tried before font size — a smaller line height is far less visually
    // disruptive than shrinking the type itself, so font size is the last
    // resort, not the fourth of five options.
    label: "Reduce line height",
    apply: (f) => ({ ...f, lineHeight: Math.max(FLOORS.lineHeight, f.lineHeight - 0.1) }),
  },
  {
    label: "Reduce font size",
    apply: (f) => ({ ...f, fontSize: Math.max(FLOORS.fontSize, f.fontSize - 0.5) }),
  },
];

export interface AutoFitResult {
  content: ResumeDocument;
  pages: number;
  actionsApplied: string[];
  fitsOnePage: boolean;
  /** Real metrics from the final measured state — richer than `pages` alone. */
  metrics?: ResumePageMetrics;
}

const MAX_PASSES = 6; // each pass retries all steps — a single 15% trim often isn't enough to close one page's worth of overflow

export async function autoFitOnePage(content: ResumeDocument): Promise<AutoFitResult> {
  let current = content;
  let pages = measurePages(current);
  const actionsApplied: string[] = [];

  if (pages <= 1) {
    const { metrics } = renderResumePdfWithMetrics(normalizeResumeContentForExport(current));
    return { content: current, pages, actionsApplied, fitsOnePage: true, metrics };
  }

  for (let pass = 0; pass < MAX_PASSES && pages > 1; pass++) {
    let improvedThisPass = false;
    for (const step of STEPS) {
      const nextFormatting = step.apply(current.formatting);
      if (JSON.stringify(nextFormatting) === JSON.stringify(current.formatting)) continue; // already at floor
      const candidate = { ...current, formatting: nextFormatting };
      const candidatePages = measurePages(candidate);
      if (candidatePages <= pages) {
        current = candidate;
        pages = candidatePages;
        actionsApplied.push(step.label);
        improvedThisPass = true;
        if (pages <= 1) break;
      }
    }
    if (!improvedThisPass) break; // every step is at its floor — formatting alone can't do more
  }

  const { metrics } = renderResumePdfWithMetrics(normalizeResumeContentForExport(current));
  return { content: current, pages, actionsApplied, fitsOnePage: pages <= 1, metrics };
}
