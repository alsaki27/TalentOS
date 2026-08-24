// src/lib/ai/application-agents/disposition.ts
// Deterministic disposition derivation for Hiring Panel. The LLM proposes a
// disposition, but the code is authoritative: the same classified job analysis
// that gates Resume Forge also decides whether this application is pursue /
// review / deprioritize / reject. No AI cost, no drift between runs.

import type { RequirementAnalysisEntry, ReviewScoreV1 } from "./schemas";

export type Disposition = "pursue" | "review" | "deprioritize" | "reject";

const DISPOSITIONS: Disposition[] = ["pursue", "review", "deprioritize", "reject"];

export function isDisposition(value: unknown): value is Disposition {
  return typeof value === "string" && (DISPOSITIONS as string[]).includes(value);
}

function categoryLabel(category: RequirementAnalysisEntry["category"]): string {
  switch (category) {
    case "cert": return "certification";
    case "credential": return "credential";
    case "clearance": return "clearance";
    case "tool": return "tool";
    default: return "requirement";
  }
}

/**
 * Role fit is deliberately decoupled from ATS keyword coverage: a high ATS
 * score can never rescue an application with a hard blocker or a missing
 * required credential. Order matters:
 *   hard_blocker → reject
 *   passFail fail → reject
 *   required cert/credential/clearance with no evidence → deprioritize
 *   passFail pass → pursue
 *   otherwise → review
 */
export function deriveDisposition(
  passFail: ReviewScoreV1["passFail"],
  analysis: { requirementAnalysis?: RequirementAnalysisEntry[] } | null | undefined
): Disposition {
  const rows = Array.isArray(analysis?.requirementAnalysis) ? analysis.requirementAnalysis : [];
  const hasHardBlocker = rows.some((row) => row.status === "hard_blocker");
  if (hasHardBlocker) return "reject";
  if (passFail === "fail") return "reject";
  const hasUnsupportedCredential = rows.some(
    (row) =>
      row.status === "unsupported" &&
      (row.category === "cert" || row.category === "credential" || row.category === "clearance")
  );
  if (hasUnsupportedCredential) return "deprioritize";
  if (passFail === "pass") return "pursue";
  return "review";
}

/**
 * Short, specific, data-driven reasons (never more than four) derived from the
 * classified requirements. Used to guarantee non-empty reasons whenever the
 * disposition is deprioritize/reject, even if the model returned none.
 */
export function buildDataDrivenReasons(
  analysis: { requirementAnalysis?: RequirementAnalysisEntry[] } | null | undefined
): string[] {
  const rows = Array.isArray(analysis?.requirementAnalysis) ? analysis.requirementAnalysis : [];
  const reasons: string[] = [];
  for (const row of rows) {
    if (reasons.length >= 4) break;
    if (row.status === "hard_blocker") {
      reasons.push(`Missing ${categoryLabel(row.category)}: ${row.requirement} (no candidate evidence)`);
    }
  }
  for (const row of rows) {
    if (reasons.length >= 4) break;
    if (
      row.status === "unsupported" &&
      (row.category === "cert" || row.category === "credential" || row.category === "clearance")
    ) {
      reasons.push(`No evidence for required ${categoryLabel(row.category)}: ${row.requirement}`);
    }
  }
  return reasons;
}

/**
 * Merge model-authored reasons with the deterministic ones and apply the
 * authoritative disposition. Guarantees the schema invariant: reject /
 * deprioritize always carry at least one explicit reason.
 */
export function applyDispositionRules(
  review: ReviewScoreV1,
  analysis: { requirementAnalysis?: RequirementAnalysisEntry[] } | null | undefined
): ReviewScoreV1 {
  const disposition = deriveDisposition(review.passFail, analysis);
  const dataReasons = buildDataDrivenReasons(analysis);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const reason of [...(review.dispositionReasons ?? []), ...dataReasons]) {
    const trimmed = reason?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return { ...review, disposition, dispositionReasons: merged };
}
