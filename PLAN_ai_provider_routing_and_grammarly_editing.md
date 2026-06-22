# Plan: multi-provider routing + Grammarly-style resume editing

Written for Kimi to implement. Each phase is independently shippable and should be
its own commit (or small set of commits) — don't combine phases. Validate with
`npm run typecheck && npm run lint` and a real `npm run cf:build` + bundle-size
check (`npx wrangler deploy --dry-run`) before pushing each phase, same discipline
as the rest of this session: this repo auto-deploys on push to
`neon-cloudflare-migration`.

## Context: what already exists, don't rebuild it

- `src/app/ops/page.tsx` + `src/app/ops/components/ai-key-manager.tsx`: a working
  admin UI for DB-managed AI keys (add/edit/disable/test, `priority`,
  `is_enabled`). The provider dropdown already lists `"openai"` — but there is no
  `openaiProvider.ts` and `buildProviderFromDbKey()` in
  `src/server/services/aiProvider.ts` returns `null` for `"openai"` and `"google"`.
  **An OpenAI key added through this UI today does nothing at runtime.** Fix this
  as part of Phase 1, don't treat it as already working.
- `src/server/services/resumeSuggestionService.ts` already produces granular,
  per-bullet suggestions (`sectionType`, `targetBlockId`, `originalText`,
  `suggestedText`, `reason`, `confidenceScore`, `truthRisk`, `atsImpact`), and
  there's already a separate accept/reject/customize endpoint for them
  (`/api/resume-suggestions/[id]/apply`). This is for application-resume
  tailoring specifically (keyword-driven). Phase 4 extends the same *shape* to
  base-resume editing, it does not invent a new suggestion model.
- `src/components/ResumeDiffViewer.tsx` already exists and does some form of
  diffing between two `ResumeDocument`s. Read it first before writing new diff
  logic in Phase 4 — extend it, don't duplicate it.
- The 4 existing provider files (`anthropicProvider.ts`, `nvidiaProvider.ts`,
  `googleProvider.ts`, `googleVertexProxyProvider.ts`) all implement the same
  `AiProvider` interface from `src/lib/ai/provider.ts`. Every new provider in
  Phase 1 follows this exact shape — read `nvidiaProvider.ts` first, since OpenAI
  and GLM are both OpenAI-compatible APIs and it's the closest existing template.

---

## Phase 1 — Add OpenAI and GLM (Zhipu) providers

**Goal:** the user has working OpenAI and GLM API keys and wants to actually use
better models for some tasks. Right now there is no code path that can.

1. Create `src/lib/ai/openaiProvider.ts`:
   - `getOpenAiProvider(): AiProvider | null`, reads `process.env.OPENAI_API_KEY`
     (return `null` if unset, matching every other provider's pattern).
   - Model from `process.env.OPENAI_MODEL`, sensible default (e.g.
     `"gpt-4.1"` or whatever the user prefers — ask if unclear, don't guess
     silently into a stale/deprecated model name).
   - Endpoint: `https://api.openai.com/v1/chat/completions`. Auth:
     `Authorization: Bearer ${apiKey}`.
   - Tool-calling: OpenAI's native `tools`/`tool_calls` format - this is the same
     shape `nvidiaProvider.ts` already implements (NVIDIA's API is OpenAI-
     compatible), so `toOpenAiTools()` in that file can likely be reused/exported
     rather than reimplemented. Check before duplicating.

2. Create `src/lib/ai/glmProvider.ts`:
   - `getGlmProvider(): AiProvider | null`, reads `process.env.GLM_API_KEY`.
   - Model from `process.env.GLM_MODEL`, default to a current GLM model (verify
     the actual current model name against Zhipu's docs — don't assume).
   - Endpoint: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
     (Zhipu's OpenAI-compatible endpoint). Auth: `Authorization: Bearer ${apiKey}`.
   - Same OpenAI-compatible tool-calling shape as above.

3. (Optional, recommended) Factor a shared `src/lib/ai/openAiCompatibleProvider.ts`
   that both new providers (and arguably `nvidiaProvider.ts`) call into,
   parameterized by `{ apiUrl, apiKey, model, defaultModel }`. Not required for
   correctness, but three near-identical OpenAI-format implementations is real
   duplication. Use judgment on whether to refactor `nvidiaProvider.ts` too in
   this same pass or leave it for later — don't let this turn into unrelated
   scope creep on a provider that already works.

4. Wire both into `src/lib/ai/index.ts`:
   - Add to the `AI_PROVIDER` explicit-override switch in `getActiveProvider()`.
   - Add to the default priority chain. Where exactly in the priority order is a
     product decision, not a technical one — ask the user, don't just append to
     the end. (They explicitly said they have "better models" available via
     these — that suggests they want them *above* the current defaults for at
     least some tasks, which Phase 2 makes precise anyway.)
   - Update the `ActiveProvider["name"]` union type to include `"openai" | "glm"`.

5. `src/server/repositories/aiKeyRepository.ts`:
   - Add `"glm"` to the `AiProvider` type union (`"openai"` is already present).

6. `src/server/services/aiProvider.ts`:
   - Add real `case "openai":` and `case "glm":` to `buildProviderFromDbKey()`
     instead of letting them fall through to `return null`. Same request-shape
     work as steps 1-2, just keyed by a DB-decrypted `apiKey` instead of an env
     var - this is the function that makes DB-managed keys for these providers
     actually usable, not just addable.

7. `src/app/ops/components/ai-key-manager.tsx`:
   - Add `"glm"` to the `PROVIDERS` array (line ~26-35).

8. Validate: typecheck, lint, build, bundle-size check (these are pure
   server-side fetch wrappers, should be near-zero bundle impact, but verify -
   this session hit real bundle-size surprises from things that looked harmless).

---

## Phase 2 — Per-task-category provider/key routing

**Goal:** "segment all tasks vs resume studio work so I can choose the AI key or
provider for each." Today every call site shares one global priority chain via
`getActiveProvider()`/`getActiveProviderAsync()`. This phase adds an *optional*
per-category override that falls back to that same global chain when unset -
purely additive, nothing breaks if a category is never configured.

1. New Neon migration (`sql/neon_fixes/00N_ai_task_category_config.sql`, additive,
   following the established convention in that directory - see its README):
   ```sql
   CREATE TABLE IF NOT EXISTS ai_task_category_config (
     category text PRIMARY KEY,
     provider text,                                   -- null = use global default chain
     ai_key_id uuid REFERENCES ai_api_keys(id) ON DELETE SET NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     updated_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL
   );
   ```
   `provider` alone (no `ai_key_id`) means "prefer this provider's env-based key,
   falling back to its highest-priority enabled DB key." `ai_key_id` set means
   "use this exact DB-managed key, full stop" - more specific than provider.

2. Propose this category taxonomy (adjust if the user wants something different,
   but this maps cleanly onto the real call sites found this session):
   - `resume_studio` — `faloodBaseResume.ts`, `faloodApplicationTailoring.ts`,
     `resumeSuggestionService.ts`, and (after Phase 4) the inline-suggestion path.
   - `chat_assistant` — `src/app/api/chat/route.ts`.
   - `parsing_extraction` — `resumeParsing.ts`, `parse-markitdown/route.ts`,
     `falood/jdAnalyzer.ts`, `target-jobs/route.ts`, `applicationKeywordService.ts`,
     `jobCategorization.ts`.
   - `content_generation` — `applicationPacketAiService.ts` (cover letters,
     recruiter messages), `digest.ts`.
   - `default` — anything not explicitly mapped; also the fallback when a row
     exists but its provider isn't actually configured.

3. New function in `src/lib/ai/index.ts`:
   ```ts
   export async function getProviderForCategory(category: string): Promise<ActiveProvider | null> {
     // 1. look up ai_task_category_config for this category
     // 2. if a row has ai_key_id, build a provider from that exact DB key
     //    (reuse buildProviderFromDbKey from server/services/aiProvider.ts)
     // 3. else if a row has provider (no specific key), try that provider's
     //    env-based getter, then its highest-priority enabled DB key
     // 4. else (no row, or override provider not actually configured) fall
     //    back to getActiveProviderAsync() - today's existing behavior, unchanged
   }
   ```

4. Update every call site identified this session (~15 files) to call
   `getProviderForCategory("<its category>")` instead of bare
   `getActiveProvider()`/`getActiveProviderAsync()`. This is mechanical but
   touches a lot of files - do it as its own commit, reviewed file-by-file, not
   folded into the routing-logic commit.

5. New admin API: `GET/PUT /api/admin/ai-task-routing` — list/update the
   category → provider/key mapping. Same auth pattern as
   `/api/admin/ai-keys` (admin-only).

6. New admin UI section (either in `ops/page.tsx` directly or a new component
   next to `ai-key-manager.tsx`): one row per category, provider dropdown
   (including "use default chain"), optional specific-key dropdown, save.

---

## Phase 3 — System health visibility

**Goal:** "modify the system health to show which is currently activated."

1. Extend `/api/ops/status`'s `aiAssistant` field from the current single
   `{ configured, provider }` shape to report per-category status:
   ```json
   {
     "default": { "configured": true, "provider": "anthropic" },
     "categories": {
       "resume_studio": { "configured": true, "provider": "openai", "source": "override" },
       "chat_assistant": { "configured": true, "provider": "anthropic", "source": "default_chain" },
       "parsing_extraction": { "configured": true, "provider": "anthropic", "source": "default_chain" },
       "content_generation": { "configured": true, "provider": "anthropic", "source": "default_chain" }
     }
   }
   ```
   `source` distinguishes "this category has an explicit override configured" from
   "this is just inheriting the global default chain" - useful for the user to
   see at a glance which categories they've actually customized.

2. Update `ops/page.tsx`'s rendering (currently one `StatusCard` for
   `aiAssistant.configured/provider`) to show one line per category instead of
   one global line.

---

## Phase 4 — Grammarly-style inline resume editing

**Goal:** "editing the resume like I am on grammarly, with assistance from the
resume" — read this as: suggestions shown inline, in context, with per-suggestion
accept/reject, not a separate list or an all-or-nothing full-document replace.

Read `src/components/ResumeDiffViewer.tsx` and
`src/server/services/resumeSuggestionService.ts` in full before starting - both
already exist and this phase extends them rather than replacing them.

1. **Keep the AI generation step as-is for base resumes.** `faloodBaseResume.ts`
   still proposes a full updated `ResumeDocument` in one shot - don't rearchitect
   the prompt/generation layer to emit granular suggestions directly, that's a
   bigger, riskier change than necessary for the UX problem being solved.

2. Compute a structural diff between the current draft and the AI's proposed
   `newContent`, per logical block (each bullet, each skill group, summary text,
   each field) rather than a flat text diff. Extend `ResumeDiffViewer.tsx`'s
   existing diffing for this if it's close enough; otherwise write a small
   `diffResumeDocument(old, new): BlockDiff[]` helper where
   `BlockDiff = { path: string; oldValue: string | null; newValue: string | null }`
   (`path` identifies the block, e.g. `experience[2].bullets[1]`).

3. In the resume preview pane (both studio pages), render each changed block
   inline: strike-through/dim the old value, show the new value next to or
   below it, with small ✓/✗ controls right there - not in a side panel.
   Unconfirmed/pending blocks stay visually distinct from confirmed content.

4. Accepting a block updates just that block in the draft (not the whole
   document); rejecting discards just that block's change and keeps the
   original. Once everything is resolved (or the user explicitly saves with
   some blocks still pending - decide whether that's allowed or blocked), the
   merged result is what actually gets saved via the existing
   `/api/base-resumes/[id]/apply-draft` endpoint - reuse it, don't build a new
   save path.

5. Extend the same per-block accept/reject pattern to the application-tailoring
   suggestions (`resumeSuggestionService.ts`'s output) so both editing surfaces
   feel consistent - they already use a compatible suggestion shape
   (`sectionType`/`targetBlockId`), this is mostly a rendering change, not a new
   backend feature, on that side.

6. This phase is the most UI-heavy and highest-risk to ship in one giant change.
   Suggest splitting it further: first get inline rendering + accept/reject
   working for base resumes (steps 1-4), validate it actually feels right to use,
   *then* extend to application tailoring (step 5) as a follow-up commit.
