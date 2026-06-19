// src/lib/falood/autoFit.ts
// One-page auto-fit engine (brief section 15). Applies the brief's ordered rules,
// re-measuring the ACTUAL rendered PDF page count after each step (via
// countResumePages, not a text-length guess) and stopping as soon as it fits.
// Only formatting is ever adjusted automatically — rules that would touch resume
// CONTENT (shortening/merging/removing bullets, rule 9's "ask the user first") are
// deliberately not auto-applied, matching "never silently delete important content."

import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";
import { countResumePages } from "@/lib/falood/pdfExport";

const FLOORS = {
  sectionSpacing: 4,
  bulletSpacing: 1,
  margin: 0.4,
  fontSize: 9.5,
  lineHeight: 1.0,
};

type FormattingStep = { label: string; apply: (f: ResumeFormatting) => ResumeFormatting };

const STEPS: FormattingStep[] = [
  {
    label: "Reduced section spacing",
    apply: (f) => ({ ...f, sectionSpacing: Math.max(FLOORS.sectionSpacing, Math.round(f.sectionSpacing * 0.85)) }),
  },
  {
    label: "Reduced bullet spacing",
    apply: (f) => ({ ...f, bulletSpacing: Math.max(FLOORS.bulletSpacing, Math.round(f.bulletSpacing * 0.85)) }),
  },
  {
    label: "Reduced margins",
    apply: (f) => ({
      ...f,
      marginTop: Math.max(FLOORS.margin, Math.round((f.marginTop - 0.08) * 100) / 100),
      marginRight: Math.max(FLOORS.margin, Math.round((f.marginRight - 0.08) * 100) / 100),
      marginBottom: Math.max(FLOORS.margin, Math.round((f.marginBottom - 0.08) * 100) / 100),
      marginLeft: Math.max(FLOORS.margin, Math.round((f.marginLeft - 0.08) * 100) / 100),
    }),
  },
  {
    label: "Reduced font size",
    apply: (f) => ({ ...f, fontSize: Math.max(FLOORS.fontSize, Math.round((f.fontSize - 0.5) * 10) / 10) }),
  },
  {
    label: "Reduced line height (compact mode)",
    apply: (f) => ({ ...f, lineHeight: Math.max(FLOORS.lineHeight, Math.round((f.lineHeight - 0.05) * 100) / 100) }),
  },
];

export interface AutoFitResult {
  content: ResumeDocument;
  pages: number;
  actionsApplied: string[];
  fitsOnePage: boolean;
}

const MAX_PASSES = 6; // each pass retries all steps — a single 15% trim often isn't enough to close one page's worth of overflow

export async function autoFitOnePage(content: ResumeDocument): Promise<AutoFitResult> {
  let current = content;
  let pages = await countResumePages(current);
  const actionsApplied: string[] = [];

  if (pages <= 1) return { content: current, pages, actionsApplied, fitsOnePage: true };

  for (let pass = 0; pass < MAX_PASSES && pages > 1; pass++) {
    let improvedThisPass = false;
    for (const step of STEPS) {
      const nextFormatting = step.apply(current.formatting);
      if (JSON.stringify(nextFormatting) === JSON.stringify(current.formatting)) continue; // already at floor
      const candidate = { ...current, formatting: nextFormatting };
      const candidatePages = await countResumePages(candidate);
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

  return { content: current, pages, actionsApplied, fitsOnePage: pages <= 1 };
}
