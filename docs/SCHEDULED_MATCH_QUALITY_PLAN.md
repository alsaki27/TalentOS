# Scheduled recommendation quality: precision-v1

## Objective and scope

Give recruiters a short list of defensible candidate-job pairs. Human approval continues to create an application and start tailoring. This change controls which automated suggestions deserve to enter that review queue. Manually captured extension items keep their human review path.

The previous automated design admitted Strong, Adjacent and Stretch tiers, treated mandatory concerns as warnings, included draft resumes, and could use ingestion time as posting freshness. Its volume and score counters do not establish matching quality.

## Admission contract implemented by this PR

1. Candidate is active, applying, and has an explicitly enabled candidate rule. A missing rule no longer enrolls the candidate. New UI selections default off. Existing explicitly saved selections are preserved for manager review.
2. Use only approved base-resume lanes owned by that candidate. Score all approved lanes for retrieval, then compare every approved lane in one bounded AI call and select the best supported lane without combining facts across resumes. A draft cannot be selected even if a stale loader returns it.
3. Require an active job, nonempty title/employer, at least 500 characters of description, a safe application/source link, and a valid publisher posting date within the configured freshness window. Missing dates are an information hold, not proof that a job is current. Ingestion date never establishes freshness.
4. Keep the configured ATS floor as a cheap retrieval filter. An ATS percentage cannot admit a suggestion. Unresolved deterministic eligibility requirements are recorded and held before paid scoring.
5. Run a precision prompt against the supplied JD and approved resume. It must compare actual work, seniority/ownership, relevant experience, explicit candidate constraints, and mandatory credentials. Required versus preferred criteria must be distinguished. School projects, tool overlap, or willingness to relocate cannot replace required professional or managerial experience.
6. Require structured role, seniority, experience and preference assessments and 3-6 distinct core-requirement comparisons. Each contains an exact JD quote and a supporting exact resume quote for a met requirement. The parser checks quote presence in the actual redacted model inputs. Explicit mandatory experience/credential clauses cannot be omitted from the evidence list.
7. Enter the review queue only when tier is Strong, score is an integer from 85 to 100, role and seniority align, experience meets the requirement (or no requirement is stated), preferences are compatible, every core requirement is supported, and no mandatory concern remains. The score is one supporting condition among these checks.
8. Adjacent, Stretch, Reject and insufficient-evidence results stay in the decision ledger with reasons. Provider outages retain the existing bounded continuation/retry flow. Invalid evidence does not produce an ATS-only suggestion. The JD and combined approved resume lanes each have a 20,000-character budget; oversized inputs are held rather than silently judged after truncation.
9. Deduplicate candidate-job pairs. A different candidate's application or pending review must not consume this candidate's opportunity. Existing rejected pairs are not repeatedly re-suggested.
10. Persist policy version, structured evidence and input hashes with each admitted/rejected assessment. Show JD and resume quotes together in Review Queue. New evidence-bearing suggestions must be re-scored if their approved resume changes before approval.

For example: a junior OSP/CAD resume and a role requiring five years of GIS administration should produce an experience/seniority gap, remain outside the normal suggestion queue, and retain its reason. An entry-level OSP drafting role with documented AutoCAD work can pass. A title containing "manager" is insufficient by itself to reject or accept: the responsibilities and documented ownership must support the decision.

## Implementation map

- `src/lib/scheduledMatchQuality.ts`: pure admission rules, input quality and quote/mandatory-clause validation.
- `candidateJobScoring.ts`: scoped precision prompt/schema/parser, full bounded inputs, source hashes; legacy manual scoring remains available.
- `scheduledCandidateLoggingService.ts`: approved-only opt-in loading, publisher freshness, deterministic holds, precision admission and candidate-scoped dedup.
- `134_scheduled_match_quality.sql`: additive JSON evidence columns and default-off candidate rules. It does not alter existing selections or remove jobs, queue items or applications.
- Review API/UI: structured evidence display. Review service: matching policy on scheduled retries, candidate-scoped duplicate check, stale-resume detection.

## Live evidence and calibration before activation

The implementation has deterministic fixtures and mocked service tests. These prove contract behavior; they do not prove that a particular production model correctly interprets a real JD. There was no approved live database connector available during this implementation, so production settings, actual queue precision, and production model behavior have not been asserted.

Use approved read-only database access to export the last 30 days of scheduled decisions and linked review outcomes. Include stable candidate/job/resume/decision IDs, source run, original posted date, ingestion timestamp, model/route, config snapshot, JD and approved resume snapshots, AI tier/reason, human decision/reason and policy version. Redact personal contact information before sharing an evaluation set. Report missing provenance explicitly.

Create a labeled set with at least 100 pairs across candidate lanes, sources and role families, including every known complaint and representative accepted cases. Two reviewers independently compare the full JD with the approved base resume while model scores and prior decisions are hidden. Resolve disagreements into Green (defensible pursuit), Gray (specific verification needed), Red (clear mismatch), or Data Hold. "Not documented" must not become an assertion that the candidate lacks a skill.

Keep a held-out portion that was not used to edit prompts. Replay the existing matcher and precision-v1 on identical inputs through the actual configured model. Record raw responses, parser failures, inputs/hashes, token counts, latency and route fallback. Preserve model, prompt and input versions so results are reproducible.

Proposed activation gates, to be signed off by the owner:

- At least 90% of admitted suggestions are independently labeled Green on the held-out set.
- Zero admitted clear wrong-domain, mandatory-experience, managerial-ownership, licensing or work-eligibility mismatches in that set.
- Zero admitted stale/undated jobs, drafts, fabricated quotes or unresolved AI failures.
- Report Green coverage as well as precision: a high reject rate with no useful matches is not success.
- Measure reviewer decision time and rejection reasons by candidate/source/role family, plus tokens per accepted suggestion. Do not claim employer receipt or screening success from an application workflow stage.

If a live model repeatedly fabricates or omits evidence, keep suggestions disabled for that route and compare a different model on the same held-out cases. Changing providers alone is not proof of quality.

## Deployment and rollback

1. Review this PR and run the included typecheck and focused regression suite.
2. Apply migration 134 before deploying code that selects/writes `match_quality`.
3. Review existing candidate selections and approve the resume lanes/profile constraints. Missing rules remain off; the migration does not silently disable saved rules.
4. Run the labeled replay and inspect missing publisher dates, description failures and unresolved eligibility flags. Repair source/profile data instead of weakening gates to restore volume.
5. Pilot a small explicitly enabled candidate group. Inspect every admitted suggestion initially and track Green/Gray/Red/Data Hold counts. Keep the human approval gate in use.
6. Expand only after the acceptance metrics hold. Use source-specific rejection rates to improve or pause weak ingest sources. Introduce configurable ranked daily caps after measuring useful-match supply and reviewer capacity; do not use a cap as evidence of precision.

Pause new matching with the existing feature toggle if needed. For code rollback, retain the additive JSON columns and restore the previous application version; migration rollback is unnecessary. Existing applications, review decisions and saved evidence remain intact. Previously rejected or completed ingestion decisions are not bulk replayed by this PR; any cleanup/replay must use exact IDs and preserve its original evidence.

## Continued quality work

Use reviewer rejection reasons to build regression fixtures and monitor drift by candidate, source, role family and model. Investigate disagreements rather than training blindly on approvals. Improve source dates, canonical requisition dedup and candidate constraints from live evidence. Relevant-years and semantic-fit judgments still require model accuracy plus human validation; quote matching proves provenance of text, not the truth of an inference.

## Local validation

The targeted suite covers admission, fabricated/omitted evidence, seniority and experience gaps, alternate-lane selection and evidence isolation, draft/oversized input refusal, publisher freshness, safe-link filtering, candidate-scoped dedup, SQL bind counts, evidence rendering/escaping, changed-resume approval holds, existing continuation/lease recovery, extension captures, review permissions/filters and the older matcher. There are 265 tests across 18 relevant test files. TypeScript and changed-file ESLint checks are also required. These checks use synthetic fixtures and mocked providers/storage; they are not live database, migration, provider or production E2E results.
