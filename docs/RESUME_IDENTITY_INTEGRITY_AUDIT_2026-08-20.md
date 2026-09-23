# Resume Identity Integrity Audit — 2026-08-20

**Scope:** the 4-stage AI resume-tailoring pipeline (Job Lens → Resume Forge → Hiring Panel → Final Polish) and whether any stage corrupts a candidate's **personal info**, **job identity**, or **education identity** relative to their base resume.

**Bottom line: no agent is currently causing these mistakes.** A live production test (4 real jobs × the candidate's 2 base resumes) and a dry-run audit of the 150 most recently generated tailored resumes both came back clean — zero identity-field drift, at every stage, in every case checked. New safeguards were still added (see below), as defense-in-depth and to close one narrow, confirmed gap unrelated to the live results.

---

## 1. Fields checked

| Category | Fields |
|---|---|
| Personal info | Candidate full name, email, phone, GitHub, LinkedIn, location |
| Job identity | Job title, company, location, start date, end date |
| Education identity | Institution, degree, graduation date |

---

## 2. Why these fields are structurally hard for the AI to corrupt

Before testing, code review found the pipeline already enforces base-resume-authoritative identity at **three separate points**, each applied independently:

1. **After Resume Forge's own AI call** (`src/lib/ai/application-agents/resumeForge.ts`)
2. **After Final Polish's own AI call** (`src/lib/ai/application-agents/finalPolish.ts`)
3. **At finalization**, after Final Polish completes (`src/lib/ai/application-agents/finalizationService.ts`) — this pass re-reads `base_resumes.content` **live from the database**, not from the workflow's start-of-run snapshot

All three call the same two functions in `src/lib/ai/application-agents/resumeIntegrity.ts` — `enforceExperienceIntegrity()` and `enforceEducationIntegrity()` — which force-overwrite job title/company/location/dates and degree/school/graduation date with the base resume's actual values, discarding whatever the AI returned for those specific fields.

**Personal info never reaches the AI at all.** Neither agent schema (`ResumeDraftV1`, `FinalResumeV1`) has a `personalInfo` field. The final document's header is populated by `finalResumeToStudioDocument.ts`'s `readHeader()`, which reads directly from the base resume's `header`/`personalInfo` object — never from any agent's output.

---

## 3. Live production test

**Method:** Created 4 real applications for the "Test Istiaque" candidate against 4 real, recently-logged jobs — 2 using base resume "MD AMINUL SARKER," 2 using base resume "SADDAM H." — and ran each through the live production pipeline (real AI calls, real production keys, no simulation). For every workflow, pulled each agent's **raw, pre-guard artifact output** plus the final persisted resume, and compared both against the base resume actually used for that run.

| Job | Company | Base resume used | Job Lens | Resume Forge | Hiring Panel | Final Polish | Final persisted resume |
|---|---|---|---|---|---|---|---|
| HVAC & Utility Mechanical Engineer | Boviet Solar Technologies | MD AMINUL SARKER | ✅ clean | ✅ clean | ✅ clean | ✅ clean | ✅ matches base |
| DFT Engineer | JNL Technologies | MD AMINUL SARKER | ✅ clean | ✅ clean | ✅ clean | ✅ clean | ✅ matches base |
| Engineer - Entry Level, Solar (PV) | Intertek | SADDAM H. | ✅ clean | ✅ clean | ✅ clean | ✅ clean | ✅ matches base |
| Mechanical Design Engineer | Insight Global | SADDAM H. | ✅ clean | ✅ clean | ✅ clean | ✅ clean | ✅ matches base |

**Note on "clean" for Job Lens/Resume Forge/Hiring Panel/Final Polish:** none of the 4 agents' raw JSON output carries a personal-info field at all (confirmed empirically, matching the code-review finding in §2) — there is structurally nothing for the AI to get wrong there. Job identity and education identity fields were present in Resume Forge's and Final Polish's raw output and matched the base resume exactly in every one of the 16 checks (4 jobs × 4 fields-groups).

All 4 workflows reached `completed` status with no errors.

---

## 4. Historical audit (150 most recent tailored resumes, all candidates)

Ran the new dry-run audit tool (`scripts/audit-resume-identity-integrity.ts --limit=150`) against the 150 most recently generated AI-tailored resumes across every candidate in production, comparing each persisted resume's personal info, job identity, and education identity against its linked base resume.

**Result: 150 checked, 0 with any mismatch.**

---

## 5. Changes made (code-complete, not yet deployed)

Even with zero issues found, three additions were built per your instruction — one closes a real (if narrow) gap, two are intentional defense-in-depth:

| # | What | File | Why |
|---|---|---|---|
| 1 | Refresh the base resume live on every pipeline stage, not just at trigger and finalization | `src/server/services/applicationAiWorkflowService.ts` (`buildAgentContext`) | Previously, stages 2–4 always read the base resume as it was at the instant the workflow *started* — a base-resume edit made seconds later, mid-workflow, wasn't picked up by Resume Forge/Hiring Panel/Final Polish (though it *was* already caught at finalization). Now every stage sees the current version. |
| 2 | New, independently-written verify-and-repair layer, run automatically right after every future finalization | `src/lib/ai/application-agents/postFinalizeIdentityAudit.ts` (wired into `finalizationService.ts`) | Deliberately not just re-calling the existing guard a 4th time — a second, separately-implemented check that would still catch a bug *in* the original guard logic, not just trust it by construction. Auto-repairs personal info / job identity / education identity field mismatches; flags (never silently auto-fixes) an experience/education *count* mismatch, since that needs a human. |
| 3 | Reusable, dry-run-by-default audit script | `scripts/audit-resume-identity-integrity.ts` | Same logic as #2, runnable on demand against any set of existing resumes. Used to produce §4 above. `--apply` to write repairs; defaults to a safe read-only report. |

`npm run typecheck` is clean on all three. Nothing has been committed or pushed — these changes are local only, pending your review.

---

## 6. Conclusion

- **No agent is currently making the mistakes you were worried about.** Job Lens, Resume Forge, Hiring Panel, and Final Polish all produced identity-clean output in a real, live, end-to-end test, and the pattern holds across 150 historical resumes.
- The protection already existed before this audit; it was not previously documented anywhere as a single, named safety property, which is likely why it wasn't visible from the outside.
- The one real gap found (mid-workflow base-resume staleness) has been fixed in code, pending deploy.
- A permanent, independent, self-repairing safety net has been added for the future, plus a reusable audit tool for spot-checking anytime.

---

## Appendix: test artifacts

- Candidate: `Test Istiaque ` (`16ad4c1b-ef2f-4535-b7b4-c5115acfe09c`)
- Applications created: 4 (real, left in place per your instruction — visible in the app for your own review)
- Diagnostic/test scripts (in `scratch/`, not shipped app code): `diagnose_identity_guard_istiaque.ts`, `diagnose_istiaque_readiness.ts`, `find_jobs_for_istiaque_test.ts`, `run_istiaque_pipeline_test.ts`, `istiaque_test_output.log` (full raw transcript of the live test run)
