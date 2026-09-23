# AI Resume Pipeline — Requirement Coverage, Bullet Skills & Final Scores
The current version code also need to store so that I can also go back this version code also.

## Goal

Add a thin quality layer on the existing 4-stage pipeline (Job Lens → Resume Forge → Hiring Panel → Final Polish → finalize) so requirements are classified, supported skills land in bullets (not only the skills section), Hiring Panel returns a short disposition, Final Polish hard-gates export readiness in TypeScript, and published ATS / recruiter / role-fit / truth scores are computed on the **finished** resume after all agents complete.

**Non-goals:** rebuild the pipeline, add new DB tables, extra AI calls in the common path, or change Source-of-Truth skill authority.

## Constraints (locked)

| Decision | Choice |
|---|---|
| SoT skills | Stay top priority for skills legitimacy. No change to SoT load/snapshot path. |
| Unsupported claims | Never invent. Surface as **candidate evidence gap**, not AI failure. |
| Export fail mode | **Soft-fail (Decision A):** `exportReady: false` + `unresolvedWarnings[]`. Still save draft. Never hard-kill the workflow. |
| Chronology | Flag only. If job has **no usable posting/date fields**, skip chronology checks entirely. |
| Scope | Extend schemas, prompts, and existing TS guards. Prefer deterministic TS over new LLM calls. |
| AI cost | Zero new calls in common path; at most **+1** bounded Resume Forge re-prompt when supported items were missed. |

## Current baseline (do not rebuild)

- Orchestrator: `src/server/services/applicationAiWorkflowService.ts`
- Schemas: `src/lib/ai/application-agents/schemas.ts`
- Agents: `jobLens.ts`, `resumeForge.ts`, `hiringPanel.ts`, `finalPolish.ts` + matching `prompts/*`
- Integrity: `resumeIntegrity.ts`, `postFinalizeIdentityAudit.ts`
- Scores today: HP LLM scores the **Forge draft**; finalize persists only `ats_score` + inverted `truth_score`; `recruiterScore` / `roleFitScore` stay in HP artifact only
- Existing soft gaps: `missingRequirements[]` (unstructured); no requirement classification / coverage matrix / disposition
- Prior plan (partial overlap): `docs/AI_RESUME_PIPELINE_REFINEMENT_PLAN_2026-08-23.md` — this plan **supersedes** it for implementation order and adds bullet-skill weaving + post-pipeline scoring

---

## Architecture (data flow)

```
Job Lens (+ base, SoT, evidence)
  → JobAnalysisV1.requirementAnalysis[]
Resume Forge
  → coverage matrix + weave supported skills into bullets
  → optional 1× “supported but missed” retry
Hiring Panel
  → scores + disposition + short reasons (advisory for Final Polish edits)
Final Polish (TS gates)
  → integrity + supported-coverage + chronology flags
  → exportReady / unresolvedWarnings
finalizeWorkflow
  → FINAL SCORE PASS on polished studio document (deterministic)
  → persist ats_score, truth_score, + new score fields if present
AE UI
  → “candidate evidence gap” labels for unsupported / hard_blocker
```

**Skills authority (unchanged order of legitimacy):**  
(1) base resume categories → (2) SoT `confirmedSkills` → (3) skills demonstrated in bullets → (4) high-confidence JD inference only when evidence exists → (5) `candidates.verified_skills`.  
Job Lens classification uses this same stack to mark support; Resume Forge may only **add/emphasize** items with `safe_to_add: true` and status `supported_by_resume` | `supported_but_not_surfaced`.

---

## Chunk 0 — Safety checkpoint

```bash
git tag pre-pipeline-req-coverage-2026-08-24
git push origin pre-pipeline-req-coverage-2026-08-24
```

---

## Chunk 1 — Job Lens: requirement classification

**Files:** `schemas.ts`, `prompts/jobLens.ts`, `jobLens.ts` (wire `ctx.baseResume`, `ctx.evidence`, `ctx.sourceOfTruth` into prompt; already on `AgentContext`).

### Schema addition on `JobAnalysisV1`

```ts
requirementAnalysis: Array<{
  requirement: string;
  category: "skill" | "tool" | "cert" | "credential" | "clearance" | "other";
  sourceEvidence: string[];      // pointers e.g. "base.experience[0].bullets[2]", "sot:AutoCAD"
  status:
    | "supported_by_resume"
    | "supported_but_not_surfaced"
    | "unsupported"
    | "hard_blocker"
    | "nice_to_have";
  safeToAdd: boolean;            // true only for supported_* with evidence
  notes?: string;                // short; optional
}>
```

Keep existing flat arrays (`requiredSkills`, `preferredSkills`, `atsKeywords`, `prohibitedUnsupportedClaims`, …) for backward compatibility. `requirementAnalysis` is the structured source of truth for downstream gates.

### Status rules (pin precisely)

| Status | Meaning |
|---|---|
| `supported_by_resume` | Already present in base resume text (skills or bullets), close match |
| `supported_but_not_surfaced` | Supported by SoT / evidence / base narrative but not written into bullets or skills section yet |
| `unsupported` | No evidence anywhere — **never** add |
| `hard_blocker` | Required license/cert/clearance/citizenship/domain credential with zero evidence (subset of `prohibitedUnsupportedClaims`) |
| `nice_to_have` | Preferred / bonus JD items |

**SoT priority:** when classifying support, SoT confirmed skills count equal to base resume. Prefer SoT-backed evidence IDs when both exist.

### Prompt / service changes

- Expand `buildJobLensPrompt(job, { baseResume, evidence, sourceOfTruth })`
- Instruct model to emit one row per material JD requirement (skills, tools, certs, clearance, must-have domain)
- Post-parse TS normalize: force `safeToAdd = false` for `unsupported` | `hard_blocker` | `nice_to_have`; force `true` only for `supported_*` with non-empty `sourceEvidence`

### Verify

- `npm run typecheck`
- Live: 1 candidate × 2 jobs → manually confirm ≥1 of each status against real base/SoT content

---

## Chunk 2 — Resume Forge: coverage matrix + bullet weaving + missed retry

**Files:** `schemas.ts` (optional structured coverage on draft), `prompts/resumeForge.ts`, `resumeForge.ts`

### 2a. Coverage matrix (before / with draft)

Add to `ResumeDraftV1` (or keep internal-only if we want zero artifact growth — **prefer persist** for AE visibility):

```ts
requirementCoverage: Array<{
  requirement: string;
  status: JobAnalysis status echo;
  surfaced: boolean;           // appears in final draft skills OR bullets
  placement?: "skills" | "bullet" | "both" | "none";
  gapReason?: "candidate_evidence_gap" | "missed_tailoring" | null;
}>
```

**Rule:** only `safeToAdd && (supported_by_resume | supported_but_not_surfaced)` may be added.  
`unsupported` / `hard_blocker` → `surfaced: false`, `gapReason: "candidate_evidence_gap"` — never invent.

### 2b. MVP — weave new skills into experience bullets

Prompt + post-check (this is the “skills section filled but bullets empty” fix):

1. For each `supported_but_not_surfaced` (and top `requiredSkills` with evidence), Forge must **rewrite an existing bullet** in the most relevant role to naturally include the tool/skill **without inventing outcomes**.
2. Prefer SoT-backed requirements first.
3. Do not add empty roles or fake employers (existing `enforceExperienceIntegrity` still runs after).
4. Skills section still expanded from SoT ∩ JD; bullets must also reflect the same keywords where evidence allows.

Shared helper (new small pure module preferred):

`src/lib/ai/application-agents/requirementCoverage.ts`

- `matchRequirementInText(req, text): boolean` — same spirit as `finalPolish.matchesKeyword`
- `buildCoverageMatrix(analysis, draft): CoverageRow[]`
- `listMissedSupported(matrix): string[]`

### 2c. “Supported but missed” retry (bounded)

After first Forge parse + integrity guards:

1. Build coverage matrix.
2. If any `supported_*` + `safeToAdd` has `surfaced: false` → **one** re-prompt with only the missed list + instruction to weave into existing bullets.
3. Re-run integrity + matrix; stop (no loop). Leftovers → `missingRequirements` / coverage `gapReason: "missed_tailoring"` for Final Polish.

### Verify

- Clean run: zero extra AI call when nothing missed
- Forced miss: retry fires once and surfaces keyword in a bullet
- Unsupported never appears in bullets/skills

---

## Chunk 3 — Hiring Panel: disposition + score separation

**Files:** `schemas.ts`, `prompts/hiringPanel.ts`, `hiringPanel.ts` (minimal)

### Schema additions on `ReviewScoreV1`

```ts
disposition: "pursue" | "review" | "deprioritize" | "reject";
dispositionReasons: string[];  // 1–4 short phrases, max ~12 words each
```

Keep existing `atsScore`, `recruiterScore`, `roleFitScore`, `truthfulnessRisk`, `passFail` (do not overload `passFail`).

### Prompt rules

- **Role fit vs ATS:** high ATS must **not** rescue poor role fit when there is major experience / credential / location / clearance / domain mismatch. If `hard_blocker` or severe role mismatch → `roleFitScore` capped low and disposition `reject` | `deprioritize`.
- SoT-confirmed skills count as truthful (not fabrication).
- Disposition reasons: short, specific, AE-readable — e.g. `"No PE license evidence"`, `"Missing OSP design years"`, `"Strong ATS keywords only"`.

### Mapping (data-driven, enforce in TS after parse)

1. Any `hard_blocker` in `requirementAnalysis` → `disposition: "reject"`, reason required  
2. Else any critical unsupported required credential → `deprioritize`  
3. Else map from `passFail` (`pass`→`pursue`, `review`→`review`, `fail`→`reject`) refined by `roleFitScore`  
4. Schema: if disposition is `deprioritize` | `reject`, `dispositionReasons.length >= 1` or inject fallback from matrix

HP remains **advisory** for Final Polish edits (not a workflow hard gate). Published scores are recomputed in Chunk 5.

### Verify

- typecheck + unit test on disposition mapping helper
- Live artifact shows non-empty short reasons on reject/deprioritize

---

## Chunk 4 — Final Polish: TS-first export gates + chronology

**Files:** `finalPolish.ts`, `resumeIntegrity.ts` (chronology helper), optionally `prompts/finalPolish.ts` (mention gates; enforcement is TS)

All gates run **after** LLM output + existing integrity/page-fit blocks. Pattern: append `unresolvedWarnings`, set `exportReady = false`. Never throw away the draft.

### 4a. Integrity gates (mostly already present — tighten)

| Gate | Action |
|---|---|
| Employment wiped vs base | already throws / restore — keep; if unrecoverable → `exportReady=false` + warning |
| Education wiped vs base | same |
| Identity / company / date drift | rely on integrity + post-finalize audit; if detectable pre-save → warning + `exportReady=false` |
| Required **supported** requirements still missing after Chunk 2 | scan final text vs `requirementAnalysis` supported_* → warning `"Missing supported requirement: X"` + `exportReady=false` |

### 4b. Chronology validator (new pure TS)

`validateEmploymentChronology(experience, job, now = new Date()): string[]`

- If job has **no** usable date (`posted_at` / `created_at` / similar all null/unparseable) → return `[]` (no flags).
- Else flag (do not rewrite): end &lt; start (beyond existing sanitize), future start far beyond now, graduation absurdly in future, “Present” role with impossible span vs job post date, etc.
- Messages go to `unresolvedWarnings` only.

### 4c. Evidence-gap framing

Warnings for unsupported/hard_blocker use prefix:

`Candidate evidence gap: …`  
(not “AI failed to add …”)

### Verify

- Deliberately strip a supported skill from draft → gate fires  
- Job without dates → no chronology warnings  
- Clean run → `exportReady` can still be true

---

## Chunk 5 — Post-pipeline final score calculation

**When:** `finalizeWorkflow` after studio document is built and integrity passes, **before** INSERT into `application_resume_versions` (or immediately after, then UPDATE — prefer before INSERT so one write).

**Why:** HP today scores the Forge draft; Final Polish may change bullets/skills. Published scores must reflect the **shipped** resume.

### 5a. Deterministic final scorer (no extra AI call)

New helper: `src/lib/ai/application-agents/finalResumeScoring.ts`

Inputs: polished resume (or studio doc text), `requirementAnalysis`, HP artifact (optional priors), integrity/chronology warnings.

Outputs (0–10 scale, same as today):

| Score | Method |
|---|---|
| **atsScore** | Coverage of `supported_*` + JD `atsKeywords` / required skills present in final skills+bullets; weight SoT-backed items slightly higher; never reward unsupported keywords |
| **roleFitScore** | Start from HP `roleFitScore`; **cap/floor** using disposition + hard_blockers + fraction of required supported items surfaced; major credential/domain gap cannot stay high |
| **recruiterScore** | Start from HP `recruiterScore`; small penalties for empty top role, unresolved formatting warnings, page overflow |
| **truthScore** | `10 - truthfulnessRisk` baseline from HP, then penalize any invented-risk signals / integrity warnings; unsupported-never-added should **not** lower truth |

Persist:

- Existing: `application_resume_versions.ats_score`, `truth_score`
- Prefer also store recruiter + role fit if columns exist or via `page_fit_metrics`-style JSON / artifact metadata — **check live columns first**; if only ATS/truth columns exist, keep recruiter/roleFit in finalization activity metadata + ensure HP+final artifacts retain them for UI. Minimal schema change: only add columns if UI already expects them; otherwise no migration.

### 5b. UI / AE surfacing (light)

- Application queue / resume parsing status: show disposition + short reasons  
- Label unsupported gaps as **candidate evidence gap**  
- Show final scores (not mid-pipeline draft scores) as the badge values

### Verify

- Same workflow: final `ats_score` differs appropriately when Final Polish drops/adds keywords  
- hard_blocker run → roleFit/disposition reject and ATS cannot “rescue”  
- Full `npm run test` + typecheck

---

## Chunk 6 — Tests & regression

| Area | Tests |
|---|---|
| `requirementCoverage.ts` | keyword match, matrix build, missed list |
| Chronology | no job date → []; bad spans → flags |
| Disposition mapping | hard_blocker → reject + reasons |
| Final scoring | coverage math golden cases |
| Existing | `resumeIntegrity.test.ts`, Forge/Polish unit tests still green |

Live smoke (same pattern as identity-guard work): 1 real candidate, 2 base resumes, 2–3 real jobs; inspect artifacts for `requirementAnalysis`, coverage, disposition, final scores.

---

## Implementation order

```
0 checkpoint
→ 1 Job Lens requirementAnalysis
→ 2 Resume Forge matrix + bullet weave + missed retry
→ 3 Hiring Panel disposition
→ 4 Final Polish TS gates + chronology
→ 5 Post-pipeline scoring + light UI labels
→ 6 tests / live smoke
```

Chunks 1→2 are hard dependencies. 3 can start after 1. 4 needs 1–2. 5 needs 4’s final document shape.

---

## Explicit non-changes

- No change to SoT snapshot-at-trigger vs live base resume re-read  
- No hard workflow failure on `exportReady: false`  
- No new stage in the pipeline  
- No bulk backfill of old workflows  
- Job Lens still does not invent candidate skills — only classifies JD requirements against evidence

## Risks

| Risk | Mitigation |
|---|---|
| Larger Job Lens prompt (base+SoT+evidence) | Cap SoT list (e.g. first 40 skills) and evidence excerpts; keep JD slice |
| Keyword match false negatives (“AutoCAD Civil 3D” vs “AutoCAD”) | Normalize: casefold, alphanumeric tokens, allow substring on significant tokens |
| Bullet weave invents metrics | Prompt + existing integrity; retry prompt forbids new employers/numbers not in base/evidence |
| Score discontinuity vs historical ATS | Document that new scores are final-resume-based; optional log both HP-draft and final in artifact metadata during rollout |

## Validation checklist (done means)

- [ ] typecheck clean  
- [ ] unit tests for coverage, chronology, disposition, final scoring  
- [ ] live run artifacts contain `requirementAnalysis`, coverage, dispositionReasons  
- [ ] unsupported never appears in polished resume  
- [ ] supported skill appears in **skills section and ≥1 bullet** when evidence exists  
- [ ] job without dates → no chronology block  
- [ ] final DB scores match post-pipeline calculator, not pre-polish draft only  
- [ ] AE-facing copy says “candidate evidence gap” for unsupported  
