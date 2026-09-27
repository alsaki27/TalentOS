# Interview Prep Document Plugin — Implementation Plan

**Status:** Planning only — nothing in this plan has been implemented yet.
**Audience:** An engineer or coding agent (e.g. Codex) implementing this feature inside the TalentOS repo.
**Author's note:** This plan was researched and written by Claude against the live TalentOS codebase (commit on `claude/youthful-dijkstra-0dg3nx`, 2026-09-27). Every file path below was confirmed to exist (or confirmed not to exist) at that time — recheck anything that looks stale before building against it, per TalentOS's own drift warnings (`.claude/skills/talentos-ops/SKILL.md`).

---

## 0. TL;DR

Build a tool that takes **(a job description) + (a resume)** and produces a **4-page, densely-formatted `.docx` "Interview Prep Document"** for the candidate — matching the exact structure, coaching content style, and pixel-level visual spec captured in `reference/master-prompt-v6.md` and demonstrated in `reference/sample-output-prep-doc.md` / `reference/samples/sample-output-prep-doc.pdf`.

The hard part is **not** "call an LLM with the master prompt." It's:
1. Getting an LLM to reliably fill a **precisely structured, precisely word-counted** content schema (not free-form prose) — this needs a multi-stage pipeline with validation/retry, the same way TalentOS's existing resume-tailoring pipeline (Resume Forge → Hiring Panel → Final Polish) already works.
2. **Deterministically rendering** that structured content into a DOCX that matches exact fonts, colors, margins, and table-column ratios — this must be code (the `docx` npm package), never left to an LLM to "write a formatted document."

Recommended build order: **Phase 1** — a standalone, DB-independent CLI/skill that proves the content pipeline + DOCX renderer against the sample fixtures in `reference/`. **Phase 2 (optional, later)** — promote the same engine into a real TalentOS feature (DB table, API route, UI button) once Phase 1's output quality and visual fidelity are validated. Everything below explains why, and exactly what to build.

---

## 1. Objective

**Input:** a job description (text) + a candidate's resume (text), optionally company/role research notes.

**Output:** a single `.docx` file, exactly 4 US-Letter portrait pages, that functions as an interview coaching instruction manual for that specific candidate + that specific role — not a generic interview guide. Content and visual format are both part of the deliverable (Master Prompt V6 §20: "FORMAT IS PART OF THE DELIVERABLE").

**Must generalize.** The News Corp / Adnan Tarif materials in `reference/` are the *test fixture*, not the target. The plugin must produce equally good output for any IT-support JD+resume pair, and ideally for any role family at all (the master prompt itself is written role-agnostically — see its §6 "Research the Role Family" and §10 "tailor them to the role family").

---

## 2. Reference materials (read these first, in this order)

All under `docs/interview-prep-plugin/`:

| File | What it is | How to use it |
|---|---|---|
| `reference/master-prompt-v6.md` | The full 21-section content + format specification, transcribed from the operator's PDF. **This is the authoritative spec.** | Read in full before writing any prompt or renderer code. Every numbered rule in it must be satisfied *somewhere* in the pipeline below — most are mapped to a specific stage or validator in §4 of this plan. |
| `reference/sample-job-description.md` | A real job posting (News Corp, Deskside Support Analyst). | Golden-path test input #1. |
| `reference/sample-resume.md` | A real resume (Adnan Tarif). | Golden-path test input #2. |
| `reference/sample-output-prep-doc.md` | The human-approved output for the above two inputs, transcribed to Markdown (content/structure only). | The golden-path *expected shape* — use it to validate your `InterviewPrepDocument` schema captures every field the real output needs, and to sanity-check tone/density, not to hard-code copy. |
| `reference/samples/*.pdf` | The three original PDFs (master prompt, JD... actually JD has no PDF, resume, sample output). | **Open `sample-output-prep-doc.pdf` directly when building the DOCX renderer.** It is the pixel-accurate ground truth for colors, fonts, spacing and table proportions — more reliable than any transcription for visual work. |

---

## 3. What already exists in TalentOS (context Codex needs before writing code)

TalentOS is a Next.js 14 App Router app (`package.json`) deployed to Cloudflare Workers via OpenNext (`wrangler.toml`, `worker-entry.mjs`), backed by a self-hosted Postgres VPS reached through Cloudflare Hyperdrive (`src/server/db/neon.ts` — still named `neon.ts` for historical reasons; there is **no ORM**, just raw parameterized SQL). It already has a full AI-driven resume-tailoring pipeline that this plugin should structurally mirror and, in Phase 2, literally plug into.

**Key facts to build against (do not skip — these prevent the most likely mistakes):**

1. **LLM calls are never made with a hardcoded provider/model in the live app.** `src/lib/ai/provider.ts` defines a provider-agnostic `AiProvider.send()` interface; concrete implementations live in `src/lib/ai/{anthropicProvider,openaiProvider,googleProvider,...}.ts`. Which provider/model actually runs is decided **at request time from the database** (`ai_routing_state_routes`, `ai_api_keys` tables, admin UI at `/admin/ai`) via `src/lib/ai/routing.ts`. **Provider API keys live encrypted in that DB table, never in `.env`** (`.env.example:24-30`, `wrangler.toml:117-127` are explicit about this for anything that is part of the deployed Worker). This matters for Phase 2 — do not add `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` to the app's env. It does **not** block Phase 1, which is a standalone local script never bundled into the Worker (see §4.1).

2. **The master-prompt text for an AI stage is not stored as data — it's a TypeScript function that assembles a template-literal string from live inputs.** See `src/lib/ai/application-agents/prompts/resumeForge.ts:113-251`, `buildResumeForgePrompt()`. This plugin's prompt builders should follow the exact same pattern: plain `.ts` files exporting `build*Prompt(input): string` functions, not a prompt stored in a markdown file or DB row read at runtime. (The `reference/master-prompt-v6.md` file in this repo is documentation of *intent*, not something the running code parses.)

3. **The tailoring pipeline is multi-stage with typed, validated JSON output at each stage, not one giant LLM call.** Current stages (`src/lib/ai/application-agents/constants.ts:27-141`): `application_resume_forge` → `application_hiring_panel` → `application_final_polish`. Each stage has a Zod-style schema in `src/lib/ai/application-agents/schemas.ts`, and `src/test/agents/agentFns.test.ts` shows the mocking pattern (`mockProvider()` / `mockProviderSequence()` feed canned responses, one per sequential `provider.send()` call). **This plugin must follow the same shape**: one JSON schema per stage, validated, with a bounded retry when validation fails (see `resumeForge.ts`'s `buildResumeForgeMissedRetryPrompt()` for the retry-prompt pattern).

4. **Two document renderers already exist, with hard-won constraints:**
   - PDF: `jsPDF` (`src/lib/falood/skarionPdfDocument.tsx`) — chosen specifically because the previous `@react-pdf/renderer` (PDFKit-based) blew Cloudflare's Worker script-size budget even when only dynamically imported client-side. It's proven safe under the current Workers **Paid** plan (9000 KiB budget) and is used **both** server- and client-side today.
   - DOCX: the `docx` npm package (`src/lib/falood/docxExport.ts:38-129` builds a `docx.Document`; rendering to bytes happens in `src/lib/falood/clientExport.tsx`, which does a **runtime dynamic `import("docx")` inside the browser** specifically to keep it out of the server bundle graph). **Server-side DOCX/PDF export is currently manually disabled** in `src/server/services/resumeExportService.ts:226-227` with a comment that looks stale — it predates the jsPDF migration, and the specific package the size-limit diagnostic flagged (`@react-pdf/pdfkit`) isn't even the `docx` package. Don't assume server-side `docx` generation is impossible; the existing disabling looks like leftover caution, not a proven limit. If Phase 2 wants server-side rendering, budget time to empirically test it (`npm run cf:build`, check output size) rather than trusting that comment.
   - **The existing `docxExport.ts` only uses `Paragraph`/`TextRun`/`HeadingLevel`/`BorderStyle`.** It has never used `Table`/`TableRow`/`TableCell`/`shading`/explicit font-family+color, which is exactly what this plugin needs for the dense multi-column tables with navy/blue header bars. The `docx` package supports all of this — TalentOS just hasn't exercised it yet. You are writing new ground here, not copying an existing table-heavy example from this repo.

5. **Database schema relevant to Phase 2** (`neon/migrations/0001_initial_schema.sql`, evolved by ~107 files in `sql/neon_fixes/*.sql` — treat `sql/01_schema.sql` as superseded/Supabase-era, not the live schema): `candidates` → `base_resumes` → `target_jobs` (candidate × job) → `application_resume_versions` (a specific tailored resume, `content jsonb`) → `applications` (canonical state in `applications.application_stage`, **not** the legacy `status`/`ae_stage` columns — see `.claude/skills/talentos-ops/SKILL.md:26`) → `application_packets` (has cover letter, recruiter message, and **an existing-but-unused `interview_prep_notes text` column** — currently pure manual free text, no AI generates it). The export-tracking pattern to mirror is `application_resume_exports` (`export_type`, `file_name`, `file_path`, `storage_provider`, `status`).

6. **No plugin/extension architecture exists inside the TalentOS product itself.** The one place "plugin" appears in this repo (`.claude/skills/talentos-ops/references/TALENTOS_MASTER_PLAYBOOK.md:3,16,494`) uses it to mean an **agent skill/tool that operates on TalentOS from outside** (the `talentos-ops-agent` itself, explicitly noted there as reconciled against "the Codex-built plugin" — i.e. Codex has built at least one tool like this for this repo before). This plan follows that same established meaning: **"plugin" = a self-contained tool + an agent-invocable skill wrapper**, not a product feature with a plugin registry. See §4 for the resulting structure.

7. **Auth pattern for any new API route** (Phase 2 only): `src/lib/auth.ts` — `const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES); if (response) return response;`. Reuse `APPLICATION_WORKER_ROLES` (`["admin","manager","application_engineer"]`) rather than inventing a new role list.

8. **AE (Application Engineer) workflow is orthogonal, not a gate.** AEs review AI-tailored resumes before submitting applications, tracked via `applications.application_stage`. Nothing about interview-prep generation needs to block or advance that stage — this reads as an addable, independent action (like the existing "export resume" button), not a new required pipeline step.

---

## 4. Recommended architecture: one engine, two front ends, built in two phases

Build the hard logic **once**, directly inside the main TalentOS TypeScript tree (so nothing has to be "ported" later), and expose it through two different entry points:

- **Phase 1 (build first):** a standalone CLI + agent skill wrapper. No DB, no auth, no Cloudflare deploy risk. Fastest path to validating the two hardest things — content-pipeline reliability and pixel-level DOCX fidelity — against the fixtures in `reference/`.
- **Phase 2 (optional, do only after Phase 1's output is validated against the sample):** a real TalentOS feature — DB table, API route, UI button — that calls the exact same engine code but sources its inputs from the live database and persists/exports through the existing patterns.

### 4.0 File layout (nothing here exists yet — this is what to create)

```
src/lib/ai/interview-prep/              # the engine — shared by both phases, no DB dependency
  types.ts                              # InterviewPrepDocument + row/section types (§4.3)
  schema.ts                             # Zod (or equivalent) validators for the same shapes
  prompts/
    evidenceExtraction.ts               # Stage A prompt builder
    positioningStrategy.ts              # Stage B prompt builder
    contentDraftPages12.ts              # Stage C1 prompt builder (Page 1 + Page 2)
    contentDraftPages34.ts              # Stage C2 prompt builder (Page 3 + Page 4)
    trimRetry.ts                        # Stage D-assist prompt builder (word-count/page-count trim)
  pipeline.ts                           # runInterviewPrepPipeline(provider, input) -> InterviewPrepDocument
  validate.ts                           # validateInterviewPrepContent() — pure code, no AI call (§4.5)
  render/
    docx.ts                             # buildInterviewPrepDocx(doc) -> docx.Document (§4.4)
    pageFitCheck.ts                     # optional jsPDF-based rendered-page-count estimate (§4.4, hardening)

scripts/
  generate-interview-prep.ts            # Phase 1 CLI entry point (§4.1)

.claude/skills/interview-prep-doc/
  SKILL.md                              # thin agent-facing wrapper, mirrors talentos-ops/SKILL.md (§4.1)

src/test/agents/interviewPrep.test.ts       # pipeline unit tests, mocked provider (mirrors agentFns.test.ts)
src/test/lib/interviewPrepDocx.test.ts      # DOCX-structure test

docs/interview-prep-plugin/                 # (this plan + reference corpus — already created)
```

Phase 2 adds (do not build until Phase 1 is validated):

```
sql/neon_fixes/108_application_interview_prep_docs.sql   # new table (§5.1) — confirm 108 is still the next free number
src/server/services/interviewPrepService.ts              # DB-routed orchestration + persistence (§5.2)
src/app/api/applications/[id]/interview-prep/route.ts    # POST generate / GET fetch latest (§5.3)
src/lib/falood/interviewPrepClientExport.ts               # client-side DOCX blob + download, mirrors clientExport.tsx (§5.4)
# + a button added to src/app/applications/[id]/page.tsx (or the Falood Studio page)
```

### 4.1 Phase 1 — standalone CLI + skill

**CLI contract:**

```bash
npx tsx scripts/generate-interview-prep.ts \
  --job-description ./jd.txt \
  --resume ./resume.txt \
  --company-notes ./notes.txt \    # optional — see Master Prompt §4 implementation note
  --candidate-name "Adnan Tarif" \
  --company-name "News Corp" \
  --role-title "Deskside Support Analyst" \
  --out ./Adnan_Tarif_NewsCorp_InterviewPrep.docx
```

**Inputs are plain text only.** Real-world resumes/JDs will be PDF or DOCX, but Phase 1 does not build a new file-format parser. Two reasons: (a) it's a solved problem elsewhere in this repo (`mammoth` for `.docx`, the `services/markitdown` microservice for PDF/DOCX → Markdown — see `src/lib/resumeParsing.ts`), and (b) when this tool is invoked *by an agent* (Claude Code, Codex) rather than a human running the raw CLI, the agent already has native file-reading tools (exactly how this plan's own reference materials were produced — the PDFs were read directly, no separate parsing step needed). Put the responsibility on the caller: the `SKILL.md` instructs an invoking agent to extract JD/resume text first (via its own file-reading tool, or the existing markitdown service if running non-interactively), then call the CLI with plain-text files. Revisit only if Phase 2 needs to accept raw file uploads through a web form with no agent in the loop.

**AI provider for Phase 1:** call `src/lib/ai/anthropicProvider.ts` (or another existing provider file) directly with an API key from a **local, non-deployed** env var (e.g. `INTERVIEW_PREP_AI_API_KEY` in a local `.env`, documented in this script's own README, never added to `.env.example`/`wrangler.toml`). This is safe specifically because `scripts/generate-interview-prep.ts` is never imported by anything under `src/app/**`, so it is never bundled into the Cloudflare Worker — it does not violate the "no provider keys in the deployed app's env" rule in `.env.example`/`wrangler.toml`, which governs the live Worker, not a local dev script (compare to existing root-level operator scripts like `retry_workflows.ts`, `testDispatch.ts`, which already talk to the DB directly for local operator use). Do not reuse the DB-driven `ai_routing_state_routes` system in Phase 1 — that would require Hyperdrive/DB access this standalone tool shouldn't need.

**Skill wrapper** (`.claude/skills/interview-prep-doc/SKILL.md`): mirror the structure of `.claude/skills/talentos-ops/SKILL.md` — frontmatter description, a short mandatory workflow ("1. Get/extract JD text and resume text as plain files. 2. Run the CLI. 3. Open the resulting docx and visually check page count/overflow against `reference/samples/sample-output-prep-doc.pdf`. 4. Hand the file to the user."), and a pointer to this plan + the `reference/` fixtures. This is what makes it "a plugin" in the same sense this repo already uses that word — an agent-invocable tool, not a hidden library.

### 4.2 Pipeline stages (the "brain")

Mirrors the existing Resume Forge → Hiring Panel → Final Polish shape (`src/lib/ai/application-agents/`). Do not attempt this as one LLM call — the master prompt itself is a 21-section, multi-phase instruction (evidence inventory → research → JD decoding → positioning strategy → four separately-specified pages, each with its own word-count and row-count rules); one call producing all of that reliably, at the required density, is not realistic and isn't how the rest of this codebase handles equally complex generation.

| Stage | Master Prompt sections covered | Input | Output |
|---|---|---|---|
| **A — Evidence + JD extraction** | §3 (evidence inventory), §7 (decode JD + calibrate maturity) | resume text, JD text | `EvidenceInventory` (roles/tools/metrics/outcomes extracted from the resume, each tagged with what competency it proves) + `JdAnalysis` (role priorities, maturity level, what must be owned independently) |
| **B — Positioning strategy** | §8 (positioning strategy), §16 (gap handling framework) | Stage A output | `PositioningStrategy` (one-line identity, 5 core messages, evidence classified EMPHASIZE/SUPPORTING/HANDLE CAREFULLY/DO NOT CLAIM, 3–5 gaps each with GAP→WHY TESTED→HONEST POSITION→ADJACENT EVIDENCE→EXACT WORDING→WHAT NOT TO CLAIM→LIKELY FOLLOW-UP) |
| **C1 — Draft Page 1 + Page 2** | §9 (page 1 spec), §10–12 (page 2 spec, STAR rules, practice-story rule) | Stage A + B output | `page1`, `page2` sections of `InterviewPrepDocument` |
| **C2 — Draft Page 3 + Page 4** | §13 (page 3 spec), §14 (page 4 spec) | Stage A + B output (+ page1/2 output, to avoid repeating the same story verbatim per §19 "no repeated answer content") | `page3`, `page4` sections |
| **D — Validate + trim** | §15 (answer quality rules), §18 (exactly 4 pages), §21 (final quality checklist) | full `InterviewPrepDocument` | pass-through, or a targeted trim re-prompt for whichever fields violate `validate.ts`'s rules (§4.5) — bounded retry, same pattern as `buildResumeForgeMissedRetryPrompt()` |

Splitting C into two calls (1+2, then 3+4) keeps each generation call's output size and attention span reasonable — four dense pages of tightly-worded content in one completion is a lot to hold consistent, and TalentOS's own pipeline already avoids one-shot mega-generations for a similarly sized problem (resume tailoring).

**Stage E — external research (Master Prompt §4–6): explicitly out of scope for v1.** The master prompt calls for live research across the company website, LinkedIn, Glassdoor, YouTube, etc. Automating that reliably needs a search/fetch tool, and unreliable "research" is worse than none (it directly risks Master Prompt §17's anti-hallucination rule — treating an inference as a fact). v1 satisfies this section with whatever the operator supplies via the optional `--company-notes` input, plus what's directly inferable from the JD text itself (which is often substantial — see how much of the News Corp sample's "COMPANY FACTS" and Page 4 Block A content comes straight from the JD). Flag automated web research as a clearly-labeled v2 idea, gated on an actual search tool being available in whatever environment runs this (e.g. if invoked by an agent that already has WebSearch/WebFetch), not something to build into the core engine.

### 4.3 Data contract — `InterviewPrepDocument`

This is the target shape for Stage C's combined output. Field-level word/row-count constraints are pulled directly from Master Prompt §9–15 — enforce them in `validate.ts` (§4.5), not just in prompt instructions (LLMs drift from prompted limits; a real check is required to hit "exactly 4 pages" reliably).

```typescript
// src/lib/ai/interview-prep/types.ts

interface InterviewPrepDocument {
  meta: {
    candidateName: string;
    companyName: string;
    roleTitle: string;
  };

  page1: {
    /** 35–60 words. */
    interviewIdentity: string;
    /** 3–5 bullets, 5–16 words each. */
    companyFacts: string[];
    /** 4–6 bullets, 5–16 words each. */
    rolePriorities: string[];
    /** 5–7 bullets, 5–16 words each. */
    cvProofAnchors: string[];
    probableQuestions: {
      /** 3–4 entries. Each ~8–20 words total, e.g. "Why this company? -> hook phrase." */
      openingFit: QuestionHook[];
      behavioralExperience: QuestionHook[];
      technicalScenario: QuestionHook[];
    };
    /** 6–8 entries (sample uses 8). Each label 4–12 words. */
    storyLabels: StoryLabel[];
    /** 3–5 items. Each 10–25 words: "{Gap}: {short honest phrasing}". */
    gapsWordCarefully: string[];
    /** ~5–8 short imperative rules. */
    mustFollow: string[];
    /** One sentence — the candidate's strongest interview identity. */
    closingReminder: string;
  };

  /** Exactly ~9 rows (Master Prompt §10: "approximately 9"). */
  page2: BehavioralRow[];

  /** ~10–14 rows (Master Prompt §13). */
  page3: TechnicalRow[];

  page4: {
    /** 6–8 rows (Master Prompt §14 Block A). */
    companyJdQuestions: CompanyQuestionRow[];
    /** 3–4 rows (Master Prompt §14 Block B): Tell me about yourself / Why this company / Why strong fit / [Why moving — only if relevant]. */
    openingAnswers: OpeningAnswerRow[];
    /** 3–5 items, each with exact honest wording (Master Prompt §16). */
    gapsExactWording: string[];
    /** 3 strong questions + at most 1 backup, so 3–4 items. */
    questionsToAsk: string[];
    /** 5–7 reminders. */
    finalCheck: string[];
    /** 45–80 words. */
    finalClosing: string;
  };
}

interface QuestionHook {
  /** e.g. "Why News Corp?" */
  question: string;
  /** e.g. "Shared technology + exact hands-on overlap + growth/learning environment." */
  hook: string;
  /** Optional pointer to a storyLabels entry, e.g. "Story 2". */
  storyRef?: string;
}

interface StoryLabel {
  id: number; // 1-based, referenced by BehavioralRow / QuestionHook
  /** 4–12 words, e.g. "High-volume queue: pressure, priority, service." */
  label: string;
  isPractice: boolean; // true => must render "PRACTICE." per Master Prompt §12
}

interface BehavioralRow {
  question: string;
  /** e.g. "Relevance, communication, confidence" — feeds the "TESTS: ..." sub-line. */
  tests: string;
  /** One memorable quoted phrase, e.g. "2+ years, cross-platform support, measurable service results." */
  answerHook: string;
  /** The sequencing instruction, e.g. "Present role + scale/metrics -> core technical scope -> ... Keep it ~60 sec." */
  howToAnswer: string;
  /** 80–140 words. The actual worked STAR answer. Prefix with "PRACTICE STAR — adapt to a true case." when built under the §12 practice-story rule. */
  modelStarExample: string;
  /** The likely pushback question + one line of coaching on how to handle it. */
  followUpCoachNote: string;
}

interface TechnicalRow {
  question: string;
  /** e.g. "Identity troubleshooting" — feeds the category label before the quoted hook. */
  testCategory: string;
  /** One quoted, memorable hook, e.g. "Separate account, MFA, session and device." */
  hook: string;
  /** 55–100 words. Procedural: clarify scope -> isolate -> test safely -> validate -> document -> escalate. */
  stepByStepAnswer: string;
  /** 3–15 words. Must be evidence the resume actually supports. */
  cvEvidence: string;
}

interface CompanyQuestionRow {
  question: string;
  whyTheyMayAsk: string;
  /** 45–90 words. */
  howToAnswerModelNotes: string;
}

interface OpeningAnswerRow {
  question: string;
  /** 90–140 words / ~45–75 seconds spoken. */
  modelAnswer: string;
}
```

### 4.4 DOCX rendering (the "renderer" — deterministic, no AI involved)

Build `src/lib/ai/interview-prep/render/docx.ts` exporting `buildInterviewPrepDocx(doc: InterviewPrepDocument): docx.Document`, following the exact split already established by `docxExport.ts`: this function only *builds* the `Document` object; the caller decides `Packer.toBuffer` (Node/CLI/server) vs `Packer.toBlob` (browser, Phase 2 client export) — same as the existing pattern.

**Visual spec — reproduce exactly (Master Prompt §20, verbatim; cross-check visually against `reference/samples/sample-output-prep-doc.pdf` at 100% zoom before calling this done):**

| Aspect | Spec |
|---|---|
| Page | US Letter portrait, 8.5×11in |
| Margins | ~0.28in top/bottom, ~0.34in left/right |
| Font | Times New Roman (or metrically close serif) |
| Body/table text | 8pt; dense technical table may drop to 7pt; never below 7pt |
| Main header text | ~9pt bold |
| Section labels / instruction lines | ~8–8.5pt bold |
| Footer | ~6–6.5pt, subdued gray |
| Header bar (every page) | 2-cell bar: left cell `{CANDIDATE} \| {COMPANY} \| {ROLE}` on dark navy `#17324D`, white bold text; right cell `PAGE {N} - {SECTION NAME}` on medium blue `#2F5D7C`, white bold text |
| Table borders | thin dark grid lines; no rounded cards/icons/decorative fills |
| Alternating row fills | white, `#F7F9FA`, `#EEF3F6` |
| Column ratios — Page 1 | 3 tables, each 3 equal-width columns |
| Column ratios — Page 2 | 12% / 23% / 48% / 17% (Question | Hook+HowTo | Model/STAR | Follow-up) |
| Column ratios — Page 3 | 12% / 18% / 51% / 19% (Question | What They Test | Step-by-Step | CV Evidence) |
| Column ratios — Page 4 Block A | 24% / 22% / 54% |
| Column ratios — Page 4 Block B | 38% / 62% |
| Column ratios — Page 4 Block C | Gaps widest, other two narrower |
| Spacing | tight cell padding, near-zero paragraph spacing, top-aligned cell content, no large blank gaps, keep rows together |

Implementation notes:
- Use `docx`'s `Table` / `TableRow` / `TableCell` with `width: { size, type: WidthType.PERCENTAGE }` for the ratios above, `shading: { fill: "17324D" }` (hex, no `#`) for header-bar cells, and explicit `font: "Times New Roman"` + `size` (half-points — `docx` sizes are in half-points, so 8pt = `16`) on every `TextRun`.
- Structure as one page-1 "section" per page or hard page breaks (`PageBreak`) between the four pages — do not rely on natural flow, since the exact-4-pages requirement means you need to control breaks deliberately once content length is bounded by `validate.ts`.
- **Page-fit verification is the single riskiest part of this whole plugin** — Master Prompt §18 requires *exactly* 4 pages, never 5, never achieved by illegally shrinking text below 7pt. Two workable strategies, in order of recommended build sequence:
  1. **v1 (do this first): word-count budgets only.** If `validate.ts` (§4.5) passes, trust that content sized within the master prompt's own word/row limits fits on 4 pages — the limits were specifically reverse-engineered from a real approved 4-page output. Add a manual step to the CLI/skill workflow: after generating, open the DOCX (or convert to PDF) and visually confirm page count before handing it to the user. This is honest, cheap, and matches what the master prompt itself says to do ("Render the DOCX and inspect all four page images at 100% zoom" — §20).
  2. **v1.5 hardening (do this once v1 works end-to-end): automated page-fit check.** TalentOS's existing pipeline already solves this exact problem for resumes — `hiringPanel.ts`/`finalPolish.ts` use jsPDF server-side purely to *measure* real page-fit, not to render the final artifact. Reuse that technique: render the drafted content through a lightweight jsPDF approximation (or actually render the real DOCX and re-open/measure it, if a reliable Node-side DOCX-page-counter exists — investigate before committing to an approach) to get a page count, and if it's not exactly 4, feed the overflow amount back into a Stage-D trim re-prompt (shorten specific fields, per the master prompt's own instruction order: "Remove repetition, shorten sentences, reduce backup material and tighten spacing first" — §18) rather than shrinking fonts.

### 4.5 Validation — `validate.ts` (pure code, runs after every generation, no AI call)

Enforce every explicit numeric constraint below. On violation, return which fields failed and why, so `pipeline.ts` can do a bounded, targeted retry (re-prompt only the offending stage/field, same pattern as `buildResumeForgeMissedRetryPrompt()`) rather than regenerating everything.

| Field | Constraint |
|---|---|
| `page1.interviewIdentity` | 35–60 words |
| `page1.companyFacts` | 3–5 items |
| `page1.rolePriorities` | 4–6 items |
| `page1.cvProofAnchors` | 5–7 items |
| `page1.probableQuestions.*` | 3–4 items per column |
| `page1.storyLabels` | 6–8 items |
| `page1.gapsWordCarefully` | items 10–25 words each |
| `page2` | ~9 rows; `modelStarExample` 80–140 words each |
| `page3` | 10–14 rows; `stepByStepAnswer` 55–100 words; `cvEvidence` 3–15 words |
| `page4.companyJdQuestions` | 6–8 rows; `howToAnswerModelNotes` 45–90 words |
| `page4.openingAnswers` | 3–4 rows; `modelAnswer` 90–140 words |
| `page4.gapsExactWording` | 3–5 items |
| `page4.questionsToAsk` | 3–4 items |
| `page4.finalCheck` | 5–7 items |
| `page4.finalClosing` | 45–80 words |

### 4.6 Anti-hallucination grounding (Master Prompt §17)

This is a correctness requirement, not a nice-to-have — an interview prep doc that puts words in a candidate's mouth about experience they don't have is actively harmful to them in the interview. Concrete approach:

1. Pass Stage A's `EvidenceInventory` (extracted verbatim from the resume) into every later stage as the *only* allowed source of candidate facts; the prompt for every drafting stage must explicitly say "only use evidence from EVIDENCE_INVENTORY below; anything else must be a PRACTICE STAR labeled as such."
2. Any `BehavioralRow.modelStarExample` not traceable to a specific `EvidenceInventory` entry must be prefixed `PRACTICE STAR — adapt to a true case before presenting it as personal history.` (Master Prompt §12) — make this a `validate.ts` check too where feasible (e.g., flag STAR examples that don't share any noun-phrase overlap with the evidence inventory as *likely* needing the practice-story label, surfaced as a warning for human review rather than a hard failure, since this check will have false positives/negatives).
3. Never let Stage B/C invent a metric. If the evidence inventory has no number for a claim, the content must use qualitative language or literally "candidate to confirm" (§12) — same rule TalentOS's own resume pipeline already enforces via its `truth_score` concept on `application_resume_versions`; this plugin doesn't need a full scoring model, just a hard "no invented numbers" rule in the prompts plus spot-checking in manual QA.

### 4.7 Testing plan (Phase 1)

Follow existing conventions: `vitest.config.ts` (`fileParallelism: false`, path alias `@` → `./src`).

- **Unit tests per stage** (`src/test/agents/interviewPrep.test.ts`): mock `AiProvider.send()` the same way `agentFns.test.ts` does (`mockProvider()` / `mockProviderSequence()`), feed each stage valid/invalid/malformed JSON, assert against the schemas in `schema.ts`, and assert the bounded-retry behavior triggers correctly on a validation failure.
- **Golden-path integration test**: run the full pipeline against `reference/sample-job-description.md` + `reference/sample-resume.md` with a mocked or real provider; assert the output passes every `validate.ts` rule (not that the prose matches the sample verbatim — the sample is a style reference, not a fixture to regurgitate).
- **DOCX structure test** (`src/test/lib/interviewPrepDocx.test.ts`): assert `buildInterviewPrepDocx()` produces the right number of tables/rows/page-breaks for a given `InterviewPrepDocument`, and that header-bar cells carry the correct hex shading. This cannot assert "renders to exactly 4 pages" (no page-layout engine in a unit test) — that stays a manual/visual QA step (§4.4) until/unless the v1.5 page-fit checker is built.
- **Manual visual QA (required before calling any milestone done):** generate a real `.docx` from the golden-path fixtures, open it, and compare side-by-side against `reference/samples/sample-output-prep-doc.pdf` at 100% zoom for font, color, margin, and column-width fidelity.

---

## 5. Phase 2 — integrate into TalentOS (optional, deferred; do not start until Phase 1 output is validated)

Only build this once a human has reviewed real Phase 1 output and is satisfied with both content quality and visual fidelity. Everything here reuses the Phase 1 engine (`src/lib/ai/interview-prep/*`) unchanged — Phase 2 is new plumbing around it, not new generation/rendering logic.

### 5.1 New table — `application_interview_prep_docs`

New migration `sql/neon_fixes/108_application_interview_prep_docs.sql` (confirm 108 is still free — check for anything added after `107_resume_forge_fallback_order.sql` before assigning the number), shaped like the existing `application_resume_exports` pattern:

```sql
CREATE TABLE application_interview_prep_docs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL REFERENCES applications(id),
  resume_version_id uuid REFERENCES application_resume_versions(id),
  job_id            uuid REFERENCES jobs(id),
  content           jsonb NOT NULL,           -- the InterviewPrepDocument, for audit/regeneration
  content_hash      text,                     -- dedupe / change detection, mirrors application_ai_artifacts pattern
  file_name         text,
  file_path         text,
  storage_provider  text,
  file_size_bytes   integer,
  status            text NOT NULL DEFAULT 'created' CHECK (status IN ('created','failed','deleted')),
  error             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

### 5.2 Service — `src/server/services/interviewPrepService.ts`

- Input resolution: given an `applicationId`, look up `applications` → `jobs` (reuse the **cached** `jobs.job_analysis`/`job_analysis_schema_version` populated by the existing pipeline — see `resumeForge.ts:125-157` — instead of re-deriving JD analysis from scratch) and → `application_resume_versions.content` for the candidate's *tailored* resume (richer signal than the base resume, since it's already been matched to this job) plus `candidates.verified_skills` for the evidence bank.
- AI calls: use the **existing DB-driven routing** (`src/lib/ai/routing.ts`, `ai_routing_state_routes`) exactly like `applicationAiWorkflowService.ts` does — do not hardcode a provider/model here. This likely means registering a new automation id (e.g. `application_interview_prep`) alongside the existing `application_resume_forge`/`application_hiring_panel`/`application_final_polish` ones in whatever config drives `ai_agent_configs`/`ai_routing_state_routes`, so it can be given its own model routing and fallback chain independent of the resume pipeline.
- Consider whether this should be a 4th stage inside the existing `application_ai_workflows` state machine (`sql/07_application_ai_workflows.sql`) or a fully independent on-demand action outside that workflow. Given §3.8's finding that this capability is orthogonal to the AE gate, **recommend independent/on-demand** (simpler, doesn't risk destabilizing the existing 3-stage workflow's state machine) — but this is a judgment call worth a second look once Phase 1 ships, not something to lock in now.
- Persist to `application_interview_prep_docs` inside a transaction, following `finalizationService.ts`'s pattern.

### 5.3 API route — `src/app/api/applications/[id]/interview-prep/route.ts`

- `POST`: trigger generation for this application. Auth: `requireCurrentUser(APPLICATION_WORKER_ROLES)`, `export const dynamic = "force-dynamic";` — copy the shape of `src/app/api/application-resume-versions/[id]/export/route.ts`.
- `GET`: fetch the latest generated doc's metadata (and/or a signed download URL, matching however `application_resume_exports` downloads work today — see `applications/[id]/resume-exports/[exportId]/download`).

### 5.4 UI

Add a "Generate Interview Prep" action on `src/app/applications/[id]/page.tsx` (or the Falood Studio page, `src/app/falood/studio/application/[applicationResumeId]/page.tsx`, if it fits the existing workflow better once you're looking at both pages live). Mirror `src/lib/falood/clientExport.tsx`'s pattern exactly: generate the `.docx` blob client-side via a runtime `import("docx")` (keeps it out of the server bundle, matching the established reason for that pattern), upload it for archiving first, then release the browser download — never let a download happen untracked.

### 5.5 Optional: candidate self-service

`src/app/portal/` already exists for candidate-facing pages. Whether a candidate should be able to pull their own interview prep doc (e.g. once `applications.application_stage` reaches an interview-scheduled state) is a product decision, not an engineering one — flagged in §7, not designed here.

---

## 6. Build order (do these in sequence; each step should be independently demoable)

1. Write `types.ts` + `schema.ts` for `InterviewPrepDocument` (§4.3).
2. Build `render/docx.ts` **against a hand-written fixture**, not AI output yet — manually transcribe `reference/sample-output-prep-doc.md`'s content into a literal `InterviewPrepDocument` object and render it. This de-risks the hardest, most novel part (exact visual fidelity) before the AI pipeline even exists, and gives you a real `.docx` to diff against `reference/samples/sample-output-prep-doc.pdf` immediately.
3. Build the Stage A–D prompt builders + `pipeline.ts`, with `AiProvider.send()` mocked in tests (§4.7) — no real API calls yet.
4. Build `validate.ts` against the table in §4.5.
5. Wire a real `AiProvider` (Anthropic, per §4.1) into `pipeline.ts` and run it end-to-end against `reference/sample-job-description.md` + `reference/sample-resume.md`. Compare output structurally (row counts, word counts via `validate.ts`) and stylistically (tone/density) against `reference/sample-output-prep-doc.md`.
6. Feed real pipeline output into the renderer from step 2. Fix any renderer assumptions that only worked for the hand-written fixture.
7. Build `scripts/generate-interview-prep.ts` (the CLI) and `.claude/skills/interview-prep-doc/SKILL.md`.
8. Run the full golden-path end-to-end, open the resulting `.docx`, and do the manual visual QA pass from §4.7 against the real sample PDF.
9. **Stop and get human sign-off on output quality + visual fidelity before starting Phase 2.**
10. (Phase 2, if approved) Work `§5.1 → §5.2 → §5.3 → §5.4` in order — migration first, then service, then route, then UI, validating each layer before building the next, same discipline as step-by-step above.

---

## 7. Open decisions (for the human operator, not Codex, to resolve — flagged rather than guessed)

- **Phase 2 timing:** build it now alongside Phase 1, or genuinely treat it as a later/separate task? This plan assumes "later," but say so explicitly if that's wrong.
- **Phase 1 AI provider/key:** confirm which provider (Anthropic vs. OpenAI vs. other) and that a key can actually be provisioned for local/standalone use outside the DB-driven `/admin/ai` system.
- **Automated web research (Master Prompt §4–6):** confirmed out of scope for v1 in this plan (§4.2 Stage E) — revisit only if generic company-context quality proves insufficient without it.
- **Candidate self-service exposure** (§5.5): should candidates ever see/download their own prep doc via the portal, or is this strictly an internal/AE-facing artifact?
- **Automated page-fit enforcement** (§4.4 v1.5): worth the extra build cost, or is "generate, then a human glances at the page count" acceptable indefinitely?

---

## 8. Risks / known gotchas (carried over from the architecture research, so they aren't rediscovered the hard way)

- **Cloudflare Worker bundle-size sensitivity is real and has bitten this repo before** (`@react-pdf/renderer` → jsPDF migration). If Phase 2 ever renders DOCX server-side, empirically verify bundle size (`npm run cf:build`) rather than assuming either "it's fine" or "it's blocked" — the current disabling in `resumeExportService.ts` looks stale, not authoritative.
- **`backend/` (a separate NestJS/TypeORM service) exists in this repo but its live-deployment status is explicitly unconfirmed** even by TalentOS's own ops playbook. Do not build any part of this plugin against it.
- **AI routing and provider keys are DB-driven and change over time** in the live app (git history shows the resume pipeline's actual provider/model has been swapped repeatedly — DeepSeek, Qwen, Google Vertex, etc., via `ai_routing_state_routes`). Phase 2 must route through the existing abstraction, never hardcode a model name.
- **The master prompt's word/row-count limits are the mechanism that makes "exactly 4 pages" achievable at all.** Loosening them "to let the AI be more thorough" will directly cause page overflow. Treat `validate.ts`'s numbers as load-bearing, not arbitrary.
- **Every claim in the output must be traceable to the resume or explicitly labeled PRACTICE STAR.** This is the single most important correctness rule in the entire master prompt (§17) — an ungrounded claim isn't just a quality bug, it can cause real harm to the candidate in a real interview.
