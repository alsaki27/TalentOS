// src/lib/ai/application-agents/evidenceAudit.ts
// Deterministic evidence-citation audit for Resume Forge's draft. No AI
// calls - pure functions over the draft's cited evidenceIds and the real
// candidate_evidence rows the model was actually given (styled like
// requirementCoverage.ts).
//
// The infrastructure this closes a gap in already existed: candidate_evidence
// has stable UUIDs, and ResumeDraftV1 already had evidenceIds/
// changeLog[].evidenceId fields - but nothing populated or checked them.
// prompts/resumeForge.ts now asks the model to cite real ids; this module is
// the deterministic check that a "citation" is actually real rather than
// trusting the model's own claim, exactly the way requirementCoverage.ts
// doesn't trust the model's self-reported requirement status either.

import type { ResumeDraftV1 } from "./schemas";

export interface EvidenceAuditResult {
  citedCount: number;
  danglingCount: number;
}

/**
 * Cross-references every evidenceId the draft cites (per-experience-entry
 * evidenceIds, changeLog[].evidenceId) against the real evidence-bank ids the
 * model was given, mutating the draft in place to strip any that don't match
 * (fabricated, hallucinated, or copied from a different candidate's evidence
 * bank in a prior turn). Never throws - a dangling id degrades to "not
 * cited" rather than failing the whole stage, the same graceful-degradation
 * pattern applyForgeGuards already uses for other soft checks.
 */
export function validateEvidenceCitations(
  draft: Pick<ResumeDraftV1, "experience" | "changeLog">,
  evidence: { id: string }[]
): EvidenceAuditResult {
  const validIds = new Set(
    (evidence ?? [])
      .filter((e): e is { id: string } => Boolean(e) && typeof e.id === "string" && e.id.length > 0)
      .map((e) => e.id)
  );

  let citedCount = 0;
  let danglingCount = 0;

  for (const exp of draft.experience ?? []) {
    const original = Array.isArray(exp.evidenceIds) ? exp.evidenceIds : [];
    const kept: string[] = [];
    for (const id of original) {
      if (typeof id === "string" && validIds.has(id)) {
        kept.push(id);
        citedCount += 1;
      } else {
        danglingCount += 1;
      }
    }
    exp.evidenceIds = kept;
  }

  for (const entry of draft.changeLog ?? []) {
    if (entry.evidenceId) {
      if (validIds.has(entry.evidenceId)) {
        citedCount += 1;
      } else {
        danglingCount += 1;
        entry.evidenceId = null;
      }
    }
  }

  return { citedCount, danglingCount };
}
