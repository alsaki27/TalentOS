# Resume Forge quality patch — developer handover

Prepared October 28, 2026. Review branch: `codex/resume-forge-quality-review`.
Based on `neon-cloudflare-migration` at `93fdaa2480936ceb19c07110ae7b89e14ece9f2a`.
Scope: code prepared for review; no production deployment, database mutation, routing change, or historical resume overwrite.

## Problem and supporting evidence

The prior Forge prompt required a one-page resume while demanding 6/4/3 minimum bullets by role, longer 2–3-line bullets, no bullet deletion, and 8–15 skills per category. Both Forge and Final Polish could restore bullets after the model shortened them. Hiring Panel explicitly encouraged generous scores and limited truthfulness risk to invented credentials. Reviewer input also truncated base-resume JSON and discarded requirement evidence pointers.

The preceding read-only production audit, ending October 27 around 23:28 America/New_York, found 559 of 1,152 selected versions generated in seven days reported two pages/overflow. Forge artifacts had a median 52 skills and selected final versions 48. Among 877 applications marked applied in that cohort, 397 were linked to two-page versions, 487 had Final Polish `exportReady=false`, and 303 had Hiring Panel disposition `reject`. These overlapping counts describe stored selections and workflow statuses, not verified external submissions or a causal interview-conversion analysis. Do not treat them as current counters or as an acceptance test for this patch.

Useful historical cases for an internal replay: A#32637 (otherwise strong fit but overflow), A#32717 (high supported-keyword coverage despite core qualification gaps), A#32659 (job title and description describe different roles). Resolve exact application/version/workflow IDs before sampling. No candidate data or secrets are included in this handover.

## Implemented changes

1. `resumeWritingPolicy.ts` supplies one shared policy: relevant evidence first, roughly 15–30-word bullets, usually 2–5 for the most relevant recent role and 1–3 for older roles, no padding quotas, and roughly 10–18 skills across the entire resume. Budgets are guidance, not destructive truncation. Extra skills require distinct supported requirements and readable page fit.
2. Forge receives the actual JD alongside its analysis. It must check role family, seniority, relevant years, ownership, and leadership separately; a JD is not candidate evidence. Conflicting job identity is surfaced for review. The 90%-confidence skill-inference permission is removed.
3. Requirement projections retain `sourceEvidence` and notes; drafting retains ambiguities. Reviewers receive complete factual base-resume sections rather than sliced JSON. Draft projections preserve unresolved truth risks and missing requirements. Confirmed skills, recruiter-verified skills, and supplied evidence-bank records reach the relevant review prompts.
4. A skill confirmed without employer-specific evidence can appear in skills, but cannot be invented as an accomplishment at a particular employer. Coverage retry now receives candidate source material for resolving pointers and asks for skills OR an evidenced bullet, not forced duplication in both.
5. Forge and Polish no longer pad concise nonempty roles back to the old quotas. Existing employment/education identity guards remain. An emptied role still falls back to available source content; no new duties are invented by deterministic code.
6. Hiring Panel evaluates unsupported tools, metrics, scope, responsibilities, leadership, years and credentials. Its pass/fail instruction now correctly treats lower truthfulness risk as better. ATS is described as supported-keyword coverage, separately from actual qualification fit.
7. Final Polish rechecks the actual post-guard/post-trim output. Missing/invalid PDF metrics, overflow, unreadability, empty role bullets, deterministic hard failures, and unresolved or rejected critical edits prevent `exportReady=true`. Drafts remain recoverable; this does not create a workflow retry loop. Structural checks do not prove every semantic claim true.
8. Deterministic QA recognizes grouped base skills and legacy object bullets, avoiding false evidence warnings. It warns above the total skill/word writing budgets without silently deleting content.
9. Successful stage records use `evidence-first-2026-10-28` as the built-in prompt version when no configured version exists. Existing configured versions still take precedence; this is not a full request/prompt hash capture.

## Validation completed locally

- Full Vitest suite: **133 files passed; 1,104 tests passed, 6 skipped**.
- Focused agents/workflow tests: **22 files, 245 tests passed**.
- TypeScript typecheck passed.
- Lint passed with warnings in existing, unchanged UI files.
- `git diff --check` passed.
- Ten new cases exercise Forge then Final Polish with mocked provider outputs, the real guards, and the actual PDF renderer. They verify 1–5 selected bullets across 1–2 roles survive without quota padding, identity survives, and source objects remain unchanged.
- Further regression cases cover late evidence beyond old truncation limits, invalid evidence flags, retry source context, grouped/legacy skill evidence, invalid/missing PDF metrics, and rejected critical edits.

These are deterministic regressions, NOT ten live model generations, browser E2E tests, a visual PDF review, or proof of improved interview outcomes. No paid provider A/B calls were made for this patch. Build/deployment checks and live semantic evaluation remain for the developer's staging review.

## Review and rollout

Fetch the review branch and inspect its diff against the base commit. Install the lockfile dependencies, then run:

```sh
npm ci
npm run typecheck
npm run lint
npm test -- --silent
npm run build
```

Before deploying, snapshot 20 representative completed applications with exact job, base-resume, source-of-truth, routing/model, and saved artifact inputs. Include junior/senior mismatch, strong fit, many-role, sparse-evidence, previously overflowing, and mismatched-title/JD cases. Preserve the original selected versions and PDFs.

Generate old and new outputs against those identical snapshots and model settings. Chain fresh Forge output into fresh Hiring Panel and fresh Final Polish. The existing `scripts/replay-pipeline-sample.ts` replays stages independently against stored artifacts and overlays live job/base data: it is useful for stage checks but is NOT a frozen paired, end-to-end A/B comparison. Do not label its `STAGE=all` result as such without changing that behavior.

For each pair retain prompts/outputs, model, version/hash, tokens, latency, final rendered PDF and page metrics. Blind-review factual accuracy, seniority, relevance, specificity, readability and missing mandatory requirements. Require zero new unsupported claims/identity drift, no empty roles, honest gap flags, and a readable one-page PDF wherever the source history can reasonably fit. An unavoidable overflow should remain a flagged draft rather than be silently approved. Track skills/bullets as diagnostics, not success criteria by themselves. Review token/cost changes: restoring complete source context increases some input sizes, so this patch does not promise lower cost.

After staging acceptance, canary a small batch, verify successful stage prompt versions and persisted final QA, then broaden. Keep route/model settings stable during comparison. Roll back the code commit if necessary; no data migration or historical rewrite is required. Existing generated versions remain unchanged until explicitly regenerated.

## Separate work still required — not implemented by this patch

**Application approval gate.** `exportReady=false` still does not itself block a staff member from moving an application to `ready_for_application` or `applied`. Finalization intentionally saves drafts. Keep that recovery behavior, but implement a central server-side transition policy shared by single/bulk/API writers: inspect the exact selected version and its latest rendered QA; hold unresolved hard failures; require an authorized reviewer override with a reason for reviewable exceptions. Record actor, source/destination stage, selected version/content hash, findings, reason and timestamp atomically. A new selected version invalidates an old clearance. Do not rely solely on low model scores and do not silently rewrite already-applied records. Start with `src/app/api/applications/[id]/route.ts`, `src/server/repositories/applicationsRepository.ts`, and canonical stage history; enumerate every other stage writer before enforcing it. Provide a clear review UI instead of causing unexplained API failures.

**Job ingestion identity.** This patch gives Forge/Panel the source JD and instructs them to flag conflicts; it does not repair wrong job records or implement a deterministic ingestion quarantine. Add title/company/description consistency review at ingestion, with provenance and human resolution. Do not overwrite a canonical title merely because another model suggests one.

**Score display and interview attribution.** Existing deterministic ATS calculation and qualification-fit scoring are not replaced here. Label supported-keyword coverage clearly; do not average it into an apparent probability of qualification. Keep qualification evidence/gaps prominent. Link interviews to application IDs and dates before claiming a conversion improvement. The audit cannot establish that this prompt caused the low interview rate.

**Prompt observability.** Record the complete effective prompt/config hash and deployed commit in future work, including failures and custom prompt overrides. The new fallback version fixes null successful-stage versions only.
