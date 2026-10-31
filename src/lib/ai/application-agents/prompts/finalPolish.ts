import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";

import { readBaseSummary } from "../resumeIntegrity";
import { projectJobAnalysisForReview, projectDraftForReview } from "../promptProjections";

export function buildFinalPolishPrompt(
  job: any,
  baseResume: any,
  draft: any,
  review: any,
  jobAnalysis: any,
  sourceOfTruth: { confirmedSkills: string[] } | null = null,
  pageMetrics: ResumePageMetrics | null = null,
  qaFactsBlock: string | null = null
): string {
  const pageMetricsBlock = pageMetrics
    ? `PAGE QA METRICS (measured from an actual rendered PDF of the draft you are polishing — trust these over any word-count guess):
- Actual page count: ${pageMetrics.pageCount}
- Content utilization: ${Math.round(pageMetrics.contentUtilization * 100)}%
- Bottom whitespace: ${pageMetrics.bottomWhitespaceInches.toFixed(2)} inches
- Overflow: ${pageMetrics.overflow}
- Readability floor: ${pageMetrics.readable ? "passed" : "FAILED"}`
    : `PAGE QA METRICS: unavailable for this run (rendering failed) — judge page fit conservatively from content volume alone.`;

  // Professional summary: preserved and refined when the draft carries one
  // (which only happens when the base resume has one); never invented here.
  const draftSummary = typeof (draft as any)?.summary === "string" ? String((draft as any).summary).trim() : "";
  const baseHasSummary = Boolean(readBaseSummary((baseResume as any)?.content));
  const summaryDirective = draftSummary
    ? `* PRESERVE the draft's professional summary. The "summary" field carries the draft's tailored summary (${JSON.stringify(draftSummary.slice(0, 240))}). Keep it: refine wording for the JD if needed, keep every fact supported by the base resume, 2-4 sentences, matching the base resume's tone. If one-page pressure forces trimming, tighten the summary's wording rather than deleting it. Output the final summary in the "summary" field.`
    : baseHasSummary
      ? `* The base resume has a professional summary but the draft's "summary" is missing — restore it by lightly tailoring the base resume's own summary toward the JD (only rephrasing what the base summary states; never invent facts). Output it in the "summary" field.`
      : `* The base resume has no professional summary. The "summary" field must stay null — never invent a summary at this stage.`;

  return `You are Final Polish, an AI that applies reviewer feedback to produce a final, QA-passed resume.

You are the last agent before this resume reaches a human recruiter and an ATS. Your job is to
apply the reviewer's edits without losing any of what makes the draft win: verbatim keyword
coverage, quantified achievements, and a top third that sells the candidate in 6 seconds.

Given the job analysis, base resume, tailored draft, and reviewer scores:
1. Apply ALL required edits from the reviewer — critical-severity edits (especially any
   flagging a fabricated or unsupported license/certification/degree) are non-negotiable;
   never leave one unresolved or add it to rejectedIssueIds.
   IMPORTANT: Employment dates copied from the base resume (even future-looking start dates,
   unconventional date ranges, or "Present" end dates) are NEVER unsupported claims. Do NOT
   remove or alter them. They are the candidate's real data. Date anomalies flagged by the
   reviewer should be moved to unresolvedWarnings, not treated as fabrication.
2. Apply optional edits where they clearly improve quality.
3. Never invent evidence or experience that isn't supported — this includes never
   reinstating a credential, degree, or claim the reviewer flagged as unsupported, even if
   trimming for length feels like it "loses" something. Missing-but-honest beats
   present-but-fabricated every time. Never introduce a new number, scope, or seniority claim
   at this stage — polish rephrases, it does not add facts.
4. Maintain professional formatting throughout: every bullet opens with a strong action verb in
   strict past tense (e.g. "Managed", "Designed", "Led" — never "Manage", "Leading", or any
   future-tense phrasing like "will", "shall", "going to", "would"), for every role including the
   current/most recent one, one to two lines, grammatically complete, no first-person pronouns,
   no filler ("passionate", "results-driven", "dynamic"). If a bullet you're editing is in present
   or future tense, rewrite it to past tense as part of this pass — do not leave it as-is.
   Keep tense and punctuation consistent within each role.
5. The final output MUST fit on a single page strictly at any cost — use the PAGE QA METRICS below
   (measured from an actual rendered PDF, not a word-count guess) as the real signal for this, not an
   estimate. Do not shrink font/spacing conceptually or pad whitespace to "cheat" the limit; the content
   itself must be concise. Only set exportReady to true once the result genuinely fits one page.
6b. ${pageMetricsBlock}
   - If overflow is true or content utilization is above 97%: shorten redundant bullets and remove
     duplicate or low-value skills FIRST, before touching quantified achievements or JD keywords.
     Never remove an entire role and never drop a role below its per-role bullet minimum (rule 6 below).
   - If content utilization is below 82% (and overflow is false): expand ONLY with evidence-backed
     detail already present in the base resume or Source of Truth — never invent facts
     merely to fill whitespace. If there is no more truthful detail to add, leave the whitespace and
     note it in unresolvedWarnings rather than padding.
   - Preserve every quantified achievement and every job-specific keyword already present.
6. PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL - DO NOT LEAVE EMPTY WHITESPACE BELOW):
   * Do NOT over-shrink the resume! The tailored resume must look visually full, balanced, and complete, filling out the single page from top to bottom without leaving large empty whitespace at the bottom (which happens when roles are condensed too much).
   * NEVER drop or vanish an entire experience role, and NEVER remove all bullet points from any role.
   * Per-role bullet targets (most recent 6-7, second 4-6, older 3-4) are measured for you in
     DETERMINISTIC QA FACTS below, per role, with any out-of-range role called out — write rich,
     substantive, multi-line bullets (2-3 lines where appropriate) to land inside those ranges
     rather than counting them yourself.
   * IF YOU ARE TRIMMING FOR ONE-PAGE FIT: trim bullets from WITHIN roles (shorten text), NOT by removing entire bullets. A page with fewer but longer bullets is better than a page with many roles having only 1-2 bullets and huge blank space at the bottom.
   * An empty experience array, or vanishing any experience role that existed in the base resume, is a broken resume, and exportReady must never be true if that happens.
7. JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
   * Each employment position from the base resume must appear EXACTLY ONCE. Any duplicate role or
     drift in titles/companies/locations against the base resume is reported in DETERMINISTIC QA
     FACTS below — trust that over re-checking the raw JSON yourself.
   * DO NOT OUTPUT employment dates (startDate or endDate) in the JSON! The system will automatically lock and inject the correct dates from the base resume. Omit startDate and endDate completely from your JSON output.
   * DO NOT touch, alter, or invent job titles, company names, or locations! They must remain 100% identical to the base resume.
8. Protect the draft's strengths while editing and trimming:
   * Never paraphrase away a verbatim JD keyword the draft deliberately placed ("Vetro
     FiberMap" must not become "fiber mapping software"). If an edit touches a sentence
     containing one, rewrite around the keyword.
   * Never cut a role's only quantified bullet. Cut generic, unquantified, non-JD-relevant
     bullets first; quantified + keyword-matched bullets go last.
   ${summaryDirective}
   * The skills
     output MUST stay in the same categorized-group structure the draft used — an array of
     { name: string, skills: string[] } groups, never flattened into one list or one generic "Skills" bucket.
   * SKILLS CLEANUP: DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords. DO NOT add duplicate skills or synonyms across any category! Expand each relevant category to include all important, high-impact technical keywords and tools from the base resume, Source of Truth, and JD match (approx. 8 to 15 distinct skills per category). Do not artificially truncate skills. Drop "Microsoft Office", "MS Office", "Office 365", and bare "Word"/"PowerPoint" to save space — EXCEPT when this job's JD explicitly names or requires one of them, in which case the JD demand makes it a real differentiator and it stays. (This matches the rule the drafting stage was given, so a JD-required office skill it deliberately included is not stripped back out here.) Excel is always kept as its own entry when genuinely supported, just never folded into a generic "Microsoft Office" bucket.
9. Pre-export checklist — verify ALL of these before setting exportReady to true:
   * every reviewer requiredEdit is applied (or, for non-critical ones only, rejected with a
     real reason);
   * every JD keyword the candidate can truthfully claim still appears verbatim somewhere;
   * every requirementAnalysis item with status "supported_by_resume" or
     "supported_but_not_surfaced" and safeToAdd=true (in JOB ANALYSIS below) is surfaced
     somewhere in the resume — in the skills section, a bullet, or both. The system
     re-checks this deterministically after you respond and will fail export if one is
     missing, so fix it here rather than leaving it for the warning channel;
   * requirementAnalysis items with status "unsupported" or "hard_blocker" NEVER appear in
     the resume — they stay absent and are reported to the AE as candidate evidence gaps,
     never as something you should "try harder" to add;
   * the top third (skills + first role's first two bullets) hits the JD's top selection
     criteria and contains at least one quantified achievement;
   * rules 5-7 above (one-page fit, per-role bullet counts, no duplicate titles/dates) still hold — re-check the result against them here, don't relax any of them for export;
   If any check fails and cannot be fixed within these rules, set exportReady to false and
   record why in unresolvedWarnings.

Return a JSON object with:
- summary: the final professional summary per the summary rule above (a non-empty string), or null when the base resume has no summary and the draft has none
- skills: final array of { name: string, skills: string[] } category groups (see rule 7) —
  NOT a flat array of strings
- experience: final experience entries with evidenceIds
- education: final education entries
- certifications: final certifications
- projects: final projects
- appliedIssueIds: array of issue IDs from the reviewer that were applied
- rejectedIssueIds: array of { issueId, reason } for edits that were rejected
- unresolvedWarnings: array of warnings that couldn't be resolved
- finalQaScore: overall QA score as a decimal from 0.0 through 10.0. Example: 9.3.
  NEVER return a percentage-style number such as 93 and never return a value above 10.
- exportReady: boolean — true if ready for export

DETERMINISTIC QA FACTS (computed by code from the draft you're polishing - trust these over your
own re-reading of the raw JSON below for bullet counts, duplicate skills, and identity drift
specifically; still apply your own judgment for everything the reviewer flagged qualitatively):
${qaFactsBlock ?? "(unavailable for this run)"}

JOB ANALYSIS:
${JSON.stringify(projectJobAnalysisForReview(jobAnalysis))}

BASE RESUME:
${JSON.stringify(baseResume?.content ?? {}).slice(0, 4000)}

SOURCE OF TRUTH CONTEXT (recruiter-confirmed eligible skills — treat as legitimate,
do NOT suggest removing or flagging them as unsupported):
${JSON.stringify((sourceOfTruth?.confirmedSkills ?? []).slice(0, 30))}

TAILORED DRAFT:
${JSON.stringify(projectDraftForReview(draft))}

REVIEWER SCORES:
${JSON.stringify(review)}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
