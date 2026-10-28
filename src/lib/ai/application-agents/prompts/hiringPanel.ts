import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";

import { readBaseSummary } from "../resumeIntegrity";
import { projectJobAnalysisForReview, projectDraftForReview, projectBaseResumeForReview, projectEvidenceForReview } from "../promptProjections";
import { resolveQualificationJobDescription } from "../qualificationFit";
import { RESUME_WRITING_RULES } from "../resumeWritingPolicy";

// Review complete candidate facts, evidence pointers and actual JD context.
export function buildHiringPanelPrompt(
  job: any,
  baseResume: any,
  draft: any,
  jobAnalysis: any,
  sourceOfTruth: { confirmedSkills: string[] } | null = null,
  evidence: any[] = [],
  pageMetrics: ResumePageMetrics | null = null,
  qaFactsBlock: string | null = null,
  verifiedSkills: string[] = []
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
specific, evidence-based feedback. Assess writing quality and actual job qualifications
separately. Give an honest review even when the best recommendation is to target a different role.

${RESUME_WRITING_RULES}

Note: If the draft contains bullets with "(added)" or "(refined)" markers, these represent AI-generated or enhanced content based on the JD. Review them for quality and accuracy against the base resume.

Review the tailored resume draft against the original job analysis and base resume.

SCORING GUIDELINES (use the available evidence; never inflate a score to encourage the candidate):
- atsScore (0-10): coverage of the requirements the candidate can truthfully support. This is
  supported-keyword coverage, NOT qualification fit or interview probability. Missing mandatory
  qualifications must lower roleFitScore and appear in dispositionReasons even when ATS is high.
- recruiterScore (0-10): does the resume read well and put relevant strengths near the top? Note
  genuinely weak phrasing (fragments, "responsible for", repeated opening verbs, buzzword filler)
  as optional edits rather than automatic score-tankers. ${baseHasSummary
    ? "This candidate's base resume HAS a professional summary, so the draft is expected to carry a tailored one - judge its quality and JD alignment; never penalize its presence."
    : "Do not penalize the lack of a professional summary - this candidate's base resume has none, and a summary must not be invented."}
- roleFitScore (0-10): evaluate mandatory qualifications, relevant years, role family, hands-on
  delivery, scope/ownership and leadership separately. Adjacent experience is partial evidence,
  not proof of senior responsibility. Research/internships must not be counted as equivalent
  professional ownership without supporting facts. Explain any material gap with source details.
  9-10 requires evidence for the core mandatory criteria; 7-8 is a strong match with limited gaps;
  5-6 has substantial adjacent experience but material gaps; 0-4 reflects a core mismatch or blocker.
  Resolve sourceEvidence pointers; neither a pointer nor a keyword is proof by itself.
- truthfulnessRisk (0-10): check ALL substantive claims against the base and verified material:
  tools, metrics, project scale, responsibilities, leadership, years, credentials and employer-specific
  use of a skill. Identify the exact unsupported claim and source checked in a requiredEdit.
  A recruiter-confirmed skill does not prove use at a particular employer. Major unsupported
  accomplishments or credentials require a critical edit; missing candidate qualifications do not
  justify inventing them. Retain uncertainty as a review issue when evidence is inconclusive.
  CRITICAL EXCLUSIONS — these are NEVER truthfulnessRisk:
    • Employment dates, start dates, or end dates copied from the base resume (even if they appear to be
      future dates or unconventional) — these come directly from the candidate's real data.
    • Reordering or rephrasing that preserves the original claim's facts and strength.
    • Skills from Source of Truth (they are recruiter-confirmed).
    • Omitting a requirement the candidate doesn't have (that is a missingRequirements item, not a risk).
    • Any formatting, date presentation, or style issue — those are formattingIssues, not truthfulnessRisk.
  Default truthfulnessRisk to 0 only when no unsupported substantive claim is found. A score of 5+ requires a "critical"
  requiredEdit with a specific, named unsupported claim, and you must state in that requiredEdit's
  description that you checked the base resume and Source of Truth and found no support for it.
- Formatting & Structure: use the PAGE QA METRICS below (measured from the actual rendered PDF) to judge page fit — not a word-count guess.
${pageMetricsBlock}
  Overflow or content utilization above 97% needs trimming. Lower utilization alone is not a defect.
  Bullet budgets are advisory; a concise, well-evidenced role must not be padded. Use DETERMINISTIC
  QA FACTS for counts/identity and your judgment for relevance. Skills target 10-18 TOTAL, not per
  category. More needs distinct supported requirements and readable page fit. Professional summary: ${baseHasSummary
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
- passFail: "pass" when ATS/recruiter/role-fit scores are >=5, truthfulnessRisk is <5, and no critical issue remains; "fail" for fabrication or an unusable resume; "review" for material fit, source, or quality uncertainty
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

ACTUAL JOB DESCRIPTION:
${resolveQualificationJobDescription(job) ?? "(unavailable - flag for review)"}
Check that the job record, description and analysis describe the same role. If they conflict,
require human review and explain the conflict; do not silently select the most convenient version.
JOB RECORD: ${JSON.stringify({ title: job?.title ?? job?.job_title, company: job?.company ?? job?.company_name })}

BASE RESUME:
${JSON.stringify(projectBaseResumeForReview(baseResume?.content ?? {}))}

SOURCE OF TRUTH CONTEXT (recruiter-confirmed eligible skills for this candidate):
${JSON.stringify(sourceOfTruth?.confirmedSkills ?? [])}

RECRUITER-VERIFIED SKILLS:
${JSON.stringify(verifiedSkills)}

EVIDENCE BANK:
${JSON.stringify(projectEvidenceForReview(evidence))}

IMPORTANT: Do NOT penalize the draft for skills that appear in Source of Truth above —
those are recruiter-confirmed. Only flag fabrication risk for claims with NO basis in
the base resume OR Source of Truth.

TAILORED DRAFT:
${JSON.stringify(projectDraftForReview(draft))}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
