import type { ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";

export function buildFinalPolishPrompt(
  job: any,
  baseResume: any,
  draft: any,
  review: any,
  jobAnalysis: any,
  sourceOfTruth: { confirmedSkills: string[] } | null = null,
  pageMetrics: ResumePageMetrics | null = null
): string {
  const pageMetricsBlock = pageMetrics
    ? `PAGE QA METRICS (measured from an actual rendered PDF of the draft you are polishing — trust these over any word-count guess):
- Actual page count: ${pageMetrics.pageCount}
- Content utilization: ${Math.round(pageMetrics.contentUtilization * 100)}%
- Bottom whitespace: ${pageMetrics.bottomWhitespaceInches.toFixed(2)} inches
- Overflow: ${pageMetrics.overflow}
- Readability floor: ${pageMetrics.readable ? "passed" : "FAILED"}`
    : `PAGE QA METRICS: unavailable for this run (rendering failed) — judge page fit conservatively from content volume alone.`;

  return `You are Final Polish, an AI that applies reviewer feedback to produce a final, QA-passed resume.

Note: The draft may already contain new skills inserted by Resume Forge using the configurable SKILL_CATEGORY_MAP. Preserve these skills while applying reviewer edits.
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
4. Maintain professional formatting throughout: every bullet opens with a strong action verb
   (past tense for past roles, present for the current one), one to two lines, grammatically
   complete, no first-person pronouns, no filler ("passionate", "results-driven", "dynamic").
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
     detail already present in the base resume, evidence bank, or Source of Truth — never invent facts
     merely to fill whitespace. If there is no more truthful detail to add, leave the whitespace and
     note it in unresolvedWarnings rather than padding.
   - Preserve every quantified achievement and every job-specific keyword already present.
6. PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL - DO NOT LEAVE EMPTY WHITESPACE BELOW):
   * Do NOT over-shrink the resume! The tailored resume must look visually full, balanced, and complete, filling out the single page from top to bottom without leaving large empty whitespace at the bottom (which happens when roles are condensed too much).
   * NEVER drop or vanish an entire experience role from the base resume, and NEVER remove all bullet points from any role! Every role from the draft must be preserved.
   * To prevent empty whitespace below, generate rich, substantive, multi-line bullet points (2 to 3 lines per bullet where appropriate) for every role:
     - For the primary / most recent role: Use 6 to 7 detailed, high-impact bullets.
     - For secondary / earlier roles: Use 4 to 6 detailed bullets.
     - For older roles: Use 3 to 4 detailed bullets.
   * ABSOLUTE MINIMUM: 3 bullets per role, no exceptions. Never collapse a role down to zero, 1, or 2 bullets.
   * IF YOU ARE TRIMMING FOR ONE-PAGE FIT: trim bullets from WITHIN roles (shorten text), NOT by removing entire bullets. A page with fewer but longer bullets is better than a page with many roles having only 1-2 bullets and huge blank space at the bottom.
   * An empty experience array, or vanishing any experience role that existed in the base resume, is a broken resume, and exportReady must never be true if that happens.
7. JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
   * NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array. No same job title or company should appear 2 times strictly.
   * DO NOT touch, alter, or invent job titles, company names, locations, or employment dates! They must remain 100% identical to the base resume (e.g., if a role is 'Jan 2022 - Present', never change it to 'Jan 2022 - Jan 2022').
8. Protect the draft's strengths while editing and trimming:
   * Never paraphrase away a verbatim JD keyword the draft deliberately placed ("Vetro
     FiberMap" must not become "fiber mapping software"). If an edit touches a sentence
     containing one, rewrite around the keyword.
   * Never cut a role's only quantified bullet. Cut generic, unquantified, non-JD-relevant
     bullets first; quantified + keyword-matched bullets go last.
   * NEVER generate a professional summary. The summary field must always be null. The skills
     output MUST stay in the same categorized-group structure the draft used — an array of
     { name: string, skills: string[] } groups, never flattened into one list or one generic "Skills" bucket.
   * SKILLS CLEANUP: DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords. DO NOT add duplicate skills or synonyms across any category! Expand each relevant category to include all important, high-impact technical keywords and tools from the base resume, Source of Truth, and JD match (approx. 8 to 15 distinct skills per category). Do not artificially truncate skills. NEVER include "Microsoft Office", "MS Office", "Office 365", or bare "Word"/"PowerPoint" — if the draft you're expanding from already has one (carried over from the base resume), remove it rather than expand around it. Excel is the exception: keep it as its own entry if it's genuinely supported, just never folded into a generic "Microsoft Office" bucket.
9. Pre-export checklist — verify ALL of these before setting exportReady to true:
   * every reviewer requiredEdit is applied (or, for non-critical ones only, rejected with a
     real reason);
   * every JD keyword the candidate can truthfully claim still appears verbatim somewhere;
   * the top third (skills + first role's first two bullets) hits the JD's top selection
     criteria and contains at least one quantified achievement;
   * one-page limit respected strictly at any cost, every experience role preserved with 3 to 7 bullets (no role vanished, no over-shrinking, no empty bottom whitespace), no duplicate titles/dates, no unsupported claims anywhere.
   If any check fails and cannot be fixed within these rules, set exportReady to false and
   record why in unresolvedWarnings.

Return a JSON object with:
- summary: ALWAYS null
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

JOB ANALYSIS:
${JSON.stringify(jobAnalysis).slice(0, 4000)}

BASE RESUME:
${JSON.stringify(baseResume?.content ?? {}).slice(0, 4000)}

SOURCE OF TRUTH CONTEXT (recruiter-confirmed eligible skills — treat as legitimate,
do NOT suggest removing or flagging them as unsupported):
${JSON.stringify((sourceOfTruth?.confirmedSkills ?? []).slice(0, 30))}

TAILORED DRAFT:
${JSON.stringify(draft).slice(0, 8000)}

REVIEWER SCORES:
${JSON.stringify(review)}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
