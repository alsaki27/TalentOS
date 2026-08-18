import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";

import { readBaseSummary } from "../resumeIntegrity";

export function buildHiringPanelPrompt(
  job: any,
  baseResume: any,
  draft: any,
  jobAnalysis: any,
  sourceOfTruth: { confirmedSkills: string[] } | null = null,
  evidence: any[] = [],
  pageMetrics: ResumePageMetrics | null = null
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

Note: The draft may contain new skills added according to the SKILL_CATEGORY_MAP defined in the Resume Forge stage. These should be treated as valid if they match JD requirements.
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
  degree, or permit that appears in the draft with ZERO support in the base resume, the EVIDENCE BANK
  below, or Source of Truth is the ONLY thing to catch (call it out as a "critical" requiredEdit).
  The EVIDENCE BANK is pre-verified, recruiter-accepted fact about this candidate — treat every item in
  it with the same authority as the base resume itself. A draft claim, bullet, or quantified detail that
  is supported by an evidence bank entry is NOT a fabrication, even if it is more specific, more
  quantified, or uses different wording than the base resume (e.g. if the evidence bank says the
  candidate led design of "15,000 fiber miles" and the base resume only says "200+ fiber miles" for a
  related bullet, citing the evidence bank's figure is legitimate tailoring, not a risk).
  CRITICAL EXCLUSIONS — these are NEVER truthfulnessRisk:
    • Employment dates, start dates, or end dates copied from the base resume (even if they appear to be
      future dates or unconventional) — these come directly from the candidate's real data.
    • Reordering or rephrasing existing experience bullets.
    • Skills from Source of Truth (they are recruiter-confirmed).
    • Any claim, number, or credential that traces to an entry in the EVIDENCE BANK below.
    • Omitting a requirement the candidate doesn't have (that is a missingRequirements item, not a risk).
    • Any formatting, date presentation, or style issue — those are formattingIssues, not truthfulnessRisk.
  Default truthfulnessRisk to 0 unless you have concrete evidence of an invented credential — meaning it
  appears in NONE of: base resume, evidence bank, Source of Truth. A score of 5+ requires a "critical"
  requiredEdit with a specific, named unsupported claim, and you must state in that requiredEdit's
  description that you checked the evidence bank and found no support for it.
- Formatting & Structure: use the PAGE QA METRICS below (measured from the actual rendered PDF) to judge page fit — not a word-count guess. Overflow or content utilization above 97% means the draft needs trimming; utilization below 82% (with no overflow) means it's too sparse. Verify that every experience role has between 3 and 7 bullets (max 7 bullets per role, min 3 bullets per role so no experience role vanishes or is left empty). Flag if any job title or company appears 2 times (no duplicates allowed). Flag if dates/titles were altered from base resume. Flag if skills section contains duplicate skills across categories or contains full JD sentence fragments (note: rich categories of 8-15 distinct skills are encouraged and valid). Professional summary: ${baseHasSummary
    ? "flag it ONLY if it is missing when expected (base resume has one), or if it contains facts with no support in the base resume/evidence bank - never flag a truthful, JD-aligned summary for existing."
    : "flag it ONLY if one is present - a summary must not be invented when the base resume has none."}

Keep requiredEdits short and only for things that meaningfully matter — this list drives trimming
in the next stage, so don't pad it with nitpicks that could cause good content to get cut.

Return a JSON object with:
- atsScore: number 0-10
- recruiterScore: number 0-10
- roleFitScore: number 0-10
- truthfulnessRisk: number 0-10
- formattingIssues: array of formatting issue descriptions
- requiredEdits: array of { issueId, description, severity: "minor"|"major"|"critical" }
- optionalEdits: array of { issueId, description }
- passFail: "pass" if all scores >= 5, "fail" only if something is genuinely broken (e.g. a real fabrication risk or an empty resume), "review" otherwise
- overallComment: brief, constructive comment

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

BASE RESUME:
${JSON.stringify(baseResume?.content ?? {}).slice(0, 6000)}

EVIDENCE BANK (pre-verified, recruiter-accepted facts about this candidate — NOT rumors or
unverified claims; anything the draft states that traces back to an entry here is truthful):
${JSON.stringify(evidence ?? []).slice(0, 8000)}

SOURCE OF TRUTH CONTEXT (recruiter-confirmed eligible skills for this candidate):
${JSON.stringify((sourceOfTruth?.confirmedSkills ?? []).slice(0, 30))}

IMPORTANT: Do NOT penalize the draft for skills that appear in Source of Truth above —
those are recruiter-confirmed. Only flag fabrication risk for claims with NO basis in
the base resume, the EVIDENCE BANK above, OR Source of Truth. Check the evidence bank
before flagging anything as unsupported.

TAILORED DRAFT:
${JSON.stringify(draft).slice(0, 12000)}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
