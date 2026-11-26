import { CANDIDATE_AGREEMENT_TEXT, CANDIDATE_AGREEMENT_VERSION } from "./candidatePortalAgreement";
import { escapeContractHtml } from "./contractSignature";

export type AgreementRun = { text: string; bold?: boolean; italic?: boolean };
export function currentTerms(candidate: { contract_terms_version?: string | null; agreement_runs?: AgreementRun[] | null }) {
  const runs = candidate.agreement_runs ?? [{ text: CANDIDATE_AGREEMENT_TEXT }];
  return { runs, text: runs.map(run => run.text).join(""), version: candidate.contract_terms_version ?? CANDIDATE_AGREEMENT_VERSION };
}

export function validRuns(value: unknown): value is AgreementRun[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  if (!value.every(run => run && typeof run.text === "string" &&
    !run.text.includes("\u0000") && Object.keys(run).every(key => key === "text" ||
      ((key === "bold" || key === "italic") && typeof run[key] === "boolean")))) return false;
  const text = value.map(run => run.text).join("");
  return text.length <= 100000 && !!text.trim();
}

export function agreementMarkup(runs: AgreementRun[]) {
  return runs.map(run => {
    let html = escapeContractHtml(run.text);
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    return html;
  }).join("");
}
