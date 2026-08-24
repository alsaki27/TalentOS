# AI Resume Pipeline Refinement — Implementation Plan (2026-08-23)

## Goal

The 4-stage pipeline (Job Lens → Resume Forge → Hiring Panel → Final Polish) is structurally sound and already has strong integrity/retry machinery. Its one real quality gap: **"unsupported by the candidate" and "supported but tailoring dropped it" currently produce the same downstream signal** — both just silently don't show up in the resume, with no structured record of which happened or why. This plan makes that distinction a first-class, machine-checkable signal (`requirementAnalysis`, Job Lens §Chunk 1) and wires the rest of the pipeline to consume it — without rebuilding the integrity, retry, or observability machinery that already exists.

**Constraint carried through every chunk below:** minimize new AI calls and new code paths. Prefer extending an existing prompt's JSON output, an existing schema, or an existing warning array over adding a new call, a new table, or a new service.

---

## Chunk 0 — Safety checkpoint (do this first)

```bash
git tag pre-pipeline-refinement-2026-08-23
git push origin pre-pipeline-refinement-2026-08-23
```

Gives a permanent, named point to diff against or roll back to, independent of ongoing commits on `neon-cloudflare-migration`. Zero risk, no code touched.

---

## Inventory — already built, do NOT rebuild

| Capability | Where it lives | Notes |
|---|---|---|
| Hiring Panel scores role fit separately from ATS keyword coverage | `hiringPanel.ts` / `prompts/hiringPanel.ts` | `atsScore` and `roleFitScore` are already independent 0-10 fields |
| One deterministic PDF repair retry on overflow/whitespace | `finalPolish.ts:63-94` (`applyDeterministicTrim`) + `finalPolish.ts:277-311` (page-fit QA block) | Renders the real PDF, trims at most one low-value bullet/role + one unmatched skill, re-renders once, gives up cleanly with a warning rather than looping. Matches the "one deterministic retry" ask almost exactly — reuse as-is |
| Employment/education/identity/date/company integrity enforcement | `resumeIntegrity.ts` (`enforceExperienceIntegrity`, `enforceEducationIntegrity`, `sanitizeEndDate`) — runs inside Resume Forge + Final Polish | Two-layer: also re-checked independently post-finalization |
| Post-finalization identity drift repair | `postFinalizeIdentityAudit.ts` | Runs after `finalizeWorkflow()`, repairs the saved DB row if drift slipped through |
| Per-agent observability: prompt version, model, retry count | `application_ai_workflows` → `StageRunRow` (`applicationAiWorkflowRepository.ts`) | Already has `prompt_version`, `model`, `attempt_number`, `provider`, `input_tokens`/`output_tokens`, `estimated_cost_usd`, `latency_ms`, `error_code`/`error_message` per stage run — this plan adds *fields inside the JSON artifacts already persisted per stage*, not a new logging system |
| A place to record export blockers | `FinalResumeSchema` → `exportReady: boolean`, `unresolvedWarnings: string[]` | Every new gate in this plan reports through this existing array |

**Rule for every chunk below:** if a capability is in this table, extend it — never re-implement it in parallel.

---

## ⚠️ Decision required before Chunk 4

`finalizationService.ts` currently treats `exportReady: false` as a **soft fail**, by explicit prior design (comment in the file: *"Previously exportReady !== true hard-failed the whole workflow with NO [resume]... Final Polish is instructed to always resolve regardless of exportReady... resume saved as draft, needs manual review."*). It always saves a draft resume version and flags it for manual AE review rather than blocking the workflow outright.

The new gates in Chunk 4 (missing supported requirements, missing packet link) need one of:
- **(A) Join the existing soft-fail path** — add to `unresolvedWarnings`, keep `exportReady: false`, AE reviews before sending. *(Recommended — consistent with existing behavior, never leaves the AE with nothing.)*
- **(B) Hard-fail** — block the workflow from completing at all when these specific conditions hit.

**This must be answered before Chunk 4 starts.** Same code path either way, different severity — but it reverses a deliberate prior decision, so it isn't a judgment call to make silently mid-implementation.

---

## Chunk 1 — Job Lens: requirement-level classification

**Files changed:**
- `src/lib/ai/application-agents/schemas.ts` — extend `JobAnalysisSchema`
- `src/lib/ai/application-agents/prompts/jobLens.ts` — prompt additions
- `src/lib/ai/application-agents/jobLens.ts` — pass new context through
- `src/lib/ai/application-agents/types.ts` — verify only (see note below)

### What to build

Add a `requirementAnalysis` array to the Job Lens output:

```json
{
  "requirement": "AutoCAD",
  "source_evidence": ["base_resume.experience[0].bullets[2]"],
  "status": "supported_by_resume" | "supported_but_not_surfaced" | "unsupported" | "hard_blocker" | "nice_to_have",
  "safe_to_add": true
}
```

**Status definitions (pin these down precisely — they drive every downstream consumer):**
- `supported_by_resume` — already appears in the base resume, verbatim or close.
- `supported_but_not_surfaced` — the evidence bank / Source of Truth / base resume supports it, but it isn't currently written into any resume bullet.
- `unsupported` — no evidence anywhere; must never be added.
- `hard_blocker` — a named license/certification/clearance/citizenship requirement (from `prohibitedUnsupportedClaims`) the candidate does not have. Define this set explicitly, e.g.: any item Job Lens already places in `prohibitedUnsupportedClaims` that has zero supporting evidence becomes `hard_blocker` automatically, not a separate judgment call.
- `nice_to_have` — maps 1:1 to the existing `preferredSkills` list.

### Real cost of this chunk

Job Lens currently only reads `ctx.job` — it does not see the base resume, evidence bank, or Source of Truth at all. To classify `supported_*` statuses it needs them. Check `AgentContext` (`types.ts`) — `baseResume`/`evidence`/`sourceOfTruth` are very likely already on that type (other agents already read `ctx.baseResume`, `ctx.evidence`, `ctx.sourceOfTruth`), so this is **wiring**, not new plumbing: pass those three into `buildJobLensPrompt()` the same way `buildResumeForgePrompt()` already receives them, and include them in the prompt text. This does add real context volume to the Job Lens call (one call, larger prompt) — not an extra AI call, but not free either. Confirm the `AgentContext` type before writing code so this doesn't turn into a new plumbing path.

### Verification
- `npm run typecheck`
- Run against a real candidate + real job (reuse the "test Istiaque" pattern from the identity-guard work: 2 base resumes × several real jobs) and manually check `requirementAnalysis` entries against the actual base resume content for at least one `supported_by_resume`, one `supported_but_not_surfaced`, and one `unsupported` case per job, confirming the classification is actually correct — not just schema-valid.

---

## Chunk 2 — Resume Forge: coverage enforcement + "supported but missed" retry

**Files changed:**
- `src/lib/ai/application-agents/prompts/resumeForge.ts` — add a hard rule referencing `requirementAnalysis`
- `src/lib/ai/application-agents/resumeForge.ts` — post-generation check + bounded retry

### What to build

1. **Coverage rule in the prompt.** Resume Forge already receives `jobAnalysis` in full. Once Chunk 1 lands, that object includes `requirementAnalysis`. Add an explicit prompt rule: *"Only items in requirementAnalysis with status supported_by_resume or supported_but_not_surfaced (and safe_to_add: true) may be added or emphasized. Every unsupported or hard_blocker item must be left out — never invented, never implied."* This formalizes what the existing prompt rule ("mention missing requirements only when supported...") already gestures at, but makes it checkable against structured data instead of a soft instruction.

2. **"Supported but missed" retry — deterministic first, bounded LLM second.** After Resume Forge returns:
   - Code-check (no AI call): for every `requirementAnalysis` item with `status: "supported_but_not_surfaced"`, does any bullet/skill in the draft mention it (simple keyword match, same style as `applyDeterministicTrim`'s `matchesKeyword` in `finalPolish.ts`)?
   - If any are missing, **one bounded re-prompt** — not a full regeneration — asking Resume Forge to weave in specifically the named missing items into existing bullets, with the same evidence-only constraint. This keeps the retry to a single extra AI call, and only in the minority of runs where something was actually missed (most runs should need zero extra calls).

### Verification
- `npm run typecheck`
- Confirm via the same live-regeneration test as Chunk 1: for a job where `requirementAnalysis` has at least one `supported_but_not_surfaced` item, verify the retry actually surfaces it in the final draft, and that the retry does *not* fire (zero extra AI call) on a run where nothing was missed.

---

## Chunk 3 — Hiring Panel: disposition field

**Files changed:**
- `src/lib/ai/application-agents/schemas.ts` — extend `ReviewScoreSchema`
- `src/lib/ai/application-agents/prompts/hiringPanel.ts` — prompt addition

### What to build

Add — do **not** overload the existing `passFail` field, other code already reads it as-is:

```ts
disposition: "pursue" | "review" | "deprioritize" | "reject";
dispositionReasons: string[]; // required, explicit — not just the numeric scores
```

Mapping logic (drive from data already available in this same call, no new inputs needed):
- Any `hard_blocker` in `requirementAnalysis` → `reject`.
- Strong `roleFitScore` but a real `unsupported` requirement present → `deprioritize`.
- Otherwise derive from existing `passFail` logic (`pass`→`pursue`, `fail`→`reject`, `review`→`review`) as the default, refined by the two rules above.

No new AI call — same Hiring Panel invocation, two more fields in its existing JSON response.

### Verification
- `npm run typecheck`
- Confirm `dispositionReasons` is never empty when `disposition` is `deprioritize` or `reject` (schema-level check, cheap to enforce in the hand-rolled validator alongside the existing `expectString`/`expectStringArray` helpers in `schemas.ts`).

---

## Chunk 4 — Final Polish: new export gates + chronology validator

**Depends on:** the Decision above being resolved.

**Files changed:**
- `src/lib/ai/application-agents/finalPolish.ts`
- `src/lib/ai/application-agents/finalizationService.ts` (packet-link gate only)

### What to build

1. **Missing supported requirements gate.** Check `requirementAnalysis` items with `status: "supported_by_resume"` or `"supported_but_not_surfaced"` against the final resume; anything still absent after Chunk 2's retry joins `unresolvedWarnings` the same way the existing page-fit warnings already do (`finalPolish.ts:294-297` is the pattern to copy).

2. **Final packet link gate.** `finalizationService.ts` currently upserts `application_packets` inside its transaction but doesn't explicitly verify the row exists before declaring the workflow done — that's implicit in the transaction succeeding. Add an explicit check after the upsert; on failure, route through the same soft/hard path as Decision (A)/(B) above.

3. **Chronology validator (new, deterministic, no AI cost).** `sanitizeEndDate` in `resumeIntegrity.ts` only checks *internal* consistency per entry (end date not before start date) — nothing today compares against the job's posting date or today's date. Add a pure function: compare each `startDate`/`endDate` against `job.posted_at` and `new Date()`; flag (never silently rewrite) anything implausible — e.g. an "ongoing" role that predates the posting by an implausible margin, a graduation date that reads as still-future when it shouldn't. Report through `unresolvedWarnings`, same channel as everything else in this chunk.

### Verification
- `npm run typecheck`
- Re-run the full "test Istiaque, 2 base resumes × 4 jobs" regeneration pass used earlier for the identity-guard work, confirming each new warning type fires correctly on a deliberately-broken test case (e.g. temporarily strip a `supported_but_not_surfaced` item from a draft to confirm the gate catches it) and stays silent on clean runs.

---

## Chunk 5 — Observability + "evidence gap" framing

**Files changed:**
- Wherever `unresolvedWarnings` is currently surfaced to staff (application queue detail view / Falood studio) — labeling only.

### What to build

No new logging system — the DB-level observability (`prompt_version`, `model`, `attempt_number`, etc. in `StageRunRow`) already exists per Chunk-0 inventory. This chunk is:
1. Confirm the new artifact fields from Chunks 1–4 (`requirementAnalysis`, `disposition`/`dispositionReasons`, the new warning types) are captured in the stage-run artifact JSON that's already persisted — likely automatic since they're just new fields on the existing schemas, but verify nothing strips them before persistence.
2. **Labeling pass:** anywhere `unsupported` items or their resulting warnings are shown to an AE, present them as **"candidate evidence gap"**, not as a pipeline error — this is the framing from the original ask, purely a UI-copy change on data that already exists once Chunk 1 lands. Prevents AEs from retrying a JD requirement no prompt can truthfully satisfy.

### Verification
- Spot-check one real workflow's stage-run rows in `application_ai_workflows` after a live test run and confirm the new fields are actually present in the persisted artifact JSON, not just in-memory.

---

## Suggested build order

```
Chunk 0 (checkpoint) → Chunk 1 (Job Lens) → Chunk 2 (Resume Forge) → Chunk 3 (Hiring Panel)
                                                                            ↓
                                              [Decision resolved] → Chunk 4 (Final Polish) → Chunk 5 (labeling)
```

Chunks 1–3 have a hard dependency order (each consumes the previous stage's new field). Chunk 3 does not block Chunk 4 mechanically, but the Decision must land before Chunk 4 starts, since it changes what Chunk 4's code actually does on failure.

---

## Testing standard for every chunk

Matches the standard already used for the identity-guard work earlier this session: no chunk is done on `npm run typecheck` alone.
- Real candidate ("test Istiaque" or equivalent), 2 base resumes, several real jobs — not synthetic fixtures.
- For classification/scoring changes (Chunks 1, 3): manually verify at least one example of each new status/disposition value against the actual underlying resume content, not just "the field is populated."
- For gates (Chunk 4): deliberately break a test case to confirm the gate actually fires, not just that it doesn't false-positive on clean runs.
- `npm run test` (full suite) before considering the whole plan complete — zero regressions.

## AI credit cost summary

| Chunk | New AI calls per normal run | New AI calls in the worst case |
|---|---|---|
| 1 (Job Lens) | 0 (same call, larger prompt + larger output) | same |
| 2 (Resume Forge) | 0 | +1 bounded re-prompt, only when something was actually missed |
| 3 (Hiring Panel) | 0 (same call, two more output fields) | same |
| 4 (Final Polish) | 0 (all three gates are deterministic/code-only) | same |
| 5 (Observability) | 0 | same |

Net: **zero new AI calls in the common case**, one bounded extra call only when Resume Forge genuinely missed a supported requirement on the first pass.
