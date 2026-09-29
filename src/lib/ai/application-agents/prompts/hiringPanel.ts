import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";

import { readBaseSummary } from "../resumeIntegrity";
import { projectJobAnalysisForReview, projectDraftForReview } from "../promptProjections";

// `evidence` is accepted but intentionally not rendered into the prompt (B5,
// 2026-09-28) - candidate_evidence has 0 rows in production. See
// buildResumeForgePrompt's doc comment for the full rationale; kept here so
// this can be re-enabled with zero plumbing changes if the table is ever
// populated.
export function buildHiringPanelPrompt(
  job: any,
  baseResume: any,
  draft: any,
  jobAnalysis: any,
  sourceOfTruth: { confirmedSkills: string[] } | null = null,
  evidence: any[] = [],
  pageMetrics: ResumePageMetrics | null = null,
  qaFactsBlock: string | null = null
): string {
  const pageMetricsBlock = pageMetrics
    ? `PAGE QA METRICS (measured from an actual rendered PDF of this draft — trust these over any word-count guess):
- Actual page count: ${pageMetrics.pageCount}
- Content utilization: ${Math.round(pageMetrics.contentUtilization * 100)}%
- Bottom whitespace: ${pageMetrics.bottomWhitespaceInches.toFixed(2)} inches
- Overflow: ${pageMetrics.overflow}
- Readability floor: ${pageMetrics.readable ? "passed" : "FAILED"}`
    : `PAGE QA METRICS: unavailable for this run (rendering failed) — judge page fit conservatively from content volume alone.`;

  const baseHasSummary = Boolean(readBaseSummary((baseResume as any)?.content));

  return `You are Hiring Panel, an AI that reviews a tailored resume draft against a job and gives
constructive, actionable feedback — like a helpful recruiter doing a quick pass, not a strict
gatekeeper. Your goal is to help the candidate improve, not to fail the resume. Always return a
full, usable review; never leave a section sparse just because you're being cautious.

Note: If the draft contains bullets with "(added)" or "(refined)" markers, these represent AI-generated or enhanced content based on the JD. Review them for quality and accuracy against the base resume.

Review the tailored resume draft against the original job analysis and base resume.

SCORING GUIDELINES (be fair and constructive — reserve low scores for genuinely weak resumes):
- atsScore (0-10): how well does the draft cover the job's key required skills and top ATS
  keywords, using close-enough or verbatim phrasing? Score generously when most of the important
  keywords are present in some reasonable form; only dock a couple points, not a full point each,
  for a handful of missing nice-to-haves. A keyword the candidate genuinely can't support (already
  in missingRequirements/excludedKeywords) should not lower the score at all.
- recruiterScore (0-10): does the resume read well and put relevant strengths near the top? Note
  genuinely weak phrasing (fragments, "responsible for", repeated opening verbs, buzzword filler)
  as optional edits rather than automatic score-tankers. ${baseHasSummary
    ? "This candidate's base resume HAS a professional summary, so the draft is expected to carry a tailored one - judge its quality and JD alignment; never penalize its presence."
    : "Do not penalize the lack of a professional summary - this candidate's base resume has none, and a summary must not be invented."}
- roleFitScore (0-10): how well does the candidate's experience align with what the role is
  actually asking for? Give credit for adjacent/transferable experience, not just exact matches.
- truthfulnessRisk (0-10): flag ONLY genuine credential fabrication — a specific license, certification,
  degree, or permit that appears in the draft with ZERO support in the base resume or Source of Truth
  is the ONLY thing to catch (call it out as a "critical" requiredEdit).
  CRITICAL EXCLUSIONS — these are NEVER truthfulnessRisk:
    • Employment dates, start dates, or end dates copied from the base resume (even if they appear to be
      future dates or unconventional) — these come directly from the candidate's real data.
    • Reordering or rephrasing existing experience bullets.
    • Skills from Source of Truth (they are recruiter-confirmed).
    • Omitting a requirement the candidate doesn't have (that is a missingRequirements item, not a risk).
    • Any formatting, date presentation, or style issue — those are formattingIssues, not truthfulnessRisk.
  Default truthfulnessRisk to 0 unless you have concrete evidence of an invented credential — meaning it
  appears in NEITHER the base resume NOR Source of Truth. A score of 5+ requires a "critical"
  requiredEdit with a specific, named unsupported claim, and you must state in that requiredEdit's
  description that you checked the base resume and Source of Truth and found no support for it.
- Formatting & Structure: use the PAGE QA METRICS below (measured from the actual rendered PDF) to judge page fit — not a word-count guess.
${pageMetricsBlock}
  Overflow or content utilization above 97% means the draft needs trimming; utilization below 82% (with no overflow) means it's too sparse. Bullet counts, duplicate skills, duplicate roles, and any drift in titles/companies/dates against the base resume are ALREADY measured for you in DETERMINISTIC QA FACTS below — do not re-derive them from the raw JSON; just raise a requiredEdit for anything that block reports as out of range or drifted. What still needs your judgment: whether the skills section contains full JD sentence fragments rather than real skill keywords (note: rich categories of 8-15 distinct skills are encouraged and valid). Professional summary: ${baseHasSummary
    ? "flag it ONLY if it is missing when expected (base resume has one), or if it contains facts with no support in the base resume - never flag a truthful, JD-aligned summary for existing."
    : "flag it ONLY if one is present - a summary must not be invented when the base resume has none."}

Keep requiredEdits short and only for things that meaningfully matter — this list drives trimming
in the next stage, so don't pad it with nitpicks that could cause good content to get cut.

DISPOSITION:
* The system re-derives "disposition" itself from requirementAnalysis and passFail after you
  respond (hard blockers and unsupported required credentials decide it, never keyword coverage),
  so just emit your honest best guess for the field and spend no reasoning on the decision rules.
* dispositionReasons IS yours and is kept: 1-4 short, fully specific phrases (max ~12 words each),
  e.g. "No PE license evidence", "Missing OSP design years", "Strong keywords but 2 years vs 5+
  required". Give reasons whenever anything counts against this application.

Return a JSON object with:
- atsScore: number 0-10
- recruiterScore: number 0-10
- roleFitScore: number 0-10
- truthfulnessRisk: number 0-10
- formattingIssues: array of formatting issue descriptions
- requiredEdits: array of { issueId, description, severity: "minor"|"major"|"critical" }
- optionalEdits: array of { issueId, description }
- passFail: "pass" if all scores >= 5, "fail" only if something is genuinely broken (e.g. a real fabrication risk or an empty resume), "review" otherwise
- disposition: "pursue" | "review" | "deprioritize" | "reject"
- dispositionReasons: array of short, specific reason strings (required, non-empty for deprioritize/reject)
- overallComment: brief, constructive comment

DETERMINISTIC QA FACTS (computed by code, not the model that wrote this draft - trust these
over your own re-reading of the raw JSON below for bullet counts, duplicate skills, and identity
drift specifically; still form your own judgment on everything else, e.g. writing quality,
role fit, and keyword relevance):
${qaFactsBlock ?? "(unavailable for this run)"}

JOB ANALYSIS:
${JSON.stringify(projectJobAnalysisForReview(jobAnalysis))}

BASE RESUME:
${JSON.stringify(baseResume?.content ?? {}).slice(0, 6000)}

SOURCE OF TRUTH CONTEXT (recruiter-confirmed eligible skills for this candidate):
${JSON.stringify((sourceOfTruth?.confirmedSkills ?? []).slice(0, 30))}

IMPORTANT: Do NOT penalize the draft for skills that appear in Source of Truth above —
those are recruiter-confirmed. Only flag fabrication risk for claims with NO basis in
the base resume OR Source of Truth.

TAILORED DRAFT:
${JSON.stringify(projectDraftForReview(draft))}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
