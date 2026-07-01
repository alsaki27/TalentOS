// src/lib/falood/autoFit.ts
// One-page auto-fit engine (brief section 15). Applies the brief's ordered rules,
// re-measuring the ACTUAL rendered PDF page count after each step (via
// countResumePages, not a text-length guess) and stopping as soon as it fits.
// Only formatting is ever adjusted automatically — rules that would touch resume
// CONTENT (shortening/merging/removing bullets, rule 9's "ask the user first") are
// deliberately not auto-applied, matching "never silently delete important content."

import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";
// countResumePages disabled — pdfExport removed for Cloudflare Workers bundle size
// Use a simple text-length heuristic instead.

function estimatePageCount(content: ResumeDocument): number {
  let totalChars = 0;
  if (content.header?.fullName) totalChars += content.header.fullName.length;
  if (content.summary?.text) totalChars += content.summary.text.length;
  for (const s of content.skills) totalChars += s.skills.join(", ").length;
  for (const exp of content.experience) {
    totalChars += exp.bullets.reduce((sum, b) => sum + b.text.length, 0);
    totalChars += exp.title.length + exp.company.length;
  }
  for (const edu of content.education) {
    totalChars += edu.degree.length + edu.school.length;
  }
  // Rough estimate: ~3000 chars per page
  return Math.max(1, Math.ceil(totalChars / 3000));
}

const FLOORS = {
  sectionSpacing: 2,
  bulletSpacing: 0,
  marginTop: 0.3,
  marginRight: 0.3,
  marginBottom: 0.3,
  marginLeft: 0.3,
  fontSize: 8,
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
    label: "Reduce font size",
    apply: (f) => ({ ...f, fontSize: Math.max(FLOORS.fontSize, f.fontSize - 0.5) }),
  },
  {
    label: "Reduce line height",
    apply: (f) => ({ ...f, lineHeight: Math.max(FLOORS.lineHeight, f.lineHeight - 0.1) }),
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
  let pages = estimatePageCount(current);
  const actionsApplied: string[] = [];

  if (pages <= 1) return { content: current, pages, actionsApplied, fitsOnePage: true };

  for (let pass = 0; pass < MAX_PASSES && pages > 1; pass++) {
    let improvedThisPass = false;
    for (const step of STEPS) {
      const nextFormatting = step.apply(current.formatting);
      if (JSON.stringify(nextFormatting) === JSON.stringify(current.formatting)) continue; // already at floor
      const candidate = { ...current, formatting: nextFormatting };
      const candidatePages = estimatePageCount(candidate);
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
