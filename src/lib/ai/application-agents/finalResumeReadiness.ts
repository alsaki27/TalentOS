import type { FinalResumeV1 } from "./schemas";
import type { DeterministicQaResult } from "./deterministicQa";

/** Keep a recoverable draft, but never report export readiness without measured QA.
 * This checks structural evidence; it does not certify the truth of model claims.
 */
export function applyFinalReadinessChecks(
  resume: FinalResumeV1,
  review: unknown,
  qa: Pick<DeterministicQaResult, "hardFailures">
): void {
  const reasons = qa.hardFailures.map((f) => `[${f.check}] ${f.detail}`);
  const fit = resume.pageFit;
  if (!fit || fit.pageCount !== 1 || fit.overflow || !fit.readable) {
    reasons.push("A readable one-page final PDF has not been verified; review before export.");
  }
  if (resume.experience.some((role) => role.bullets.every((b) => !b.trim()))) {
    reasons.push("An employment entry has no supported bullet; verify source material before export.");
  }
  const record = review && typeof review === "object" ? review as Record<string, unknown> : {};
  const requiredEdits = Array.isArray(record.requiredEdits) ? record.requiredEdits : [];
  for (const edit of requiredEdits) {
    if (!edit || edit.severity !== "critical") continue;
    if (typeof edit.issueId !== "string" || !resume.appliedIssueIds.includes(edit.issueId)
      || resume.rejectedIssueIds.some((r) => r.issueId === edit.issueId)) {
      reasons.push(`Critical review issue remains unresolved: ${typeof edit.issueId === "string" ? edit.issueId : "missing issue ID"}.`);
    }
  }
  if (reasons.length) {
    resume.exportReady = false;
    resume.unresolvedWarnings = Array.from(new Set([...resume.unresolvedWarnings, ...reasons]));
  }
}
