# Falood AI Copilot — Job-Description Fix + One-at-a-Time Skill Gap Suggestions (2026-08-24)

## Part 1 — Bug fix (already done)

**Confirmed and fixed before this plan was written**, not a future chunk:

The AI Copilot chat (`/falood/studio/tailor/[id]`) sends `state.jobDescription` to `/api/falood/suggestions` on every single prompt — but the bridge that creates each session (`POST /api/falood/applications/from-source`) was storing the job's **title** (a few words, e.g. `"Drafter"`, `"Aerial Supervisor Telecom"`) in the `job_description` field, never the real JD text. Confirmed live against 5 real saved sessions — none had more than 30 characters of "description." The Copilot has never actually seen a real job description.

**Fix:** the route now selects `jobs.description_text`/`description_html`/`notes`/`raw_source_payload` and resolves the real JD text via `resolveJobDescription()` (already shared with Job Lens in the 4-agent pipeline — same fallback chain, one function, no duplicated logic). New sessions get it correctly; existing sessions get their `job_description` backfilled on next open (content/chat history stay untouched, per the existing "immutable" design for `application_resume_version` sessions — only the pure-context field changes). Verified end-to-end: a real session went from 7 characters to 8,908 characters of real JD text. `npm run typecheck` clean, full suite 319/319 passing.

This directly addresses "it should access that particular logged job's description strictly" — it now does, for the first time.

---


## Part 2 — New: one-at-a-time skill-gap suggestions (planning only, not built yet)

### What exists already (verified against the real code — don't rebuild these)

| Piece | Where | Status |
|---|---|---|
| Real, live job description per session | `job_description` column, now fixed above | ✅ Ready to use |
| Candidate's current (live) base resumes as reference context | `buildCandidateContext()` in `faloodAiService.ts` — queries `base_resumes` fresh on every call, not cached | ✅ Already wired into every Copilot prompt |
| Tailored resume's current skills | `resumeData.skills` (simple or categorized), already in the chat context | ✅ Ready to use |
| A `"skill"` suggestion type with accept/reject | `Suggestion` interface (`AiSuggestions.tsx`) + `applySuggestionToResumeData()` | ⚠️ Exists, but see the gap below |
| A JD-skill extractor | `EXTRACT_SKILLS_SYSTEM_PROMPT` / the extract-skills call in `faloodAiService.ts` | ✅ Already extracts required/preferred skills from a JD |

**The actual gap:** today, a single `"skill"` suggestion's `suggested` field is a **JSON array of multiple skills at once** — the system prompt explicitly tells the model to bundle several new skills into one suggestion object. Accepting it adds all of them together. This is the literal thing you flagged: *"I can [accept] one skill/tool (one at a time) not altogether."* Nothing needs inventing here — the suggestion/accept/reject plumbing already exists and already works one-suggestion-at-a-time; the fix is entirely about **what one suggestion contains** and **when suggestions get generated**.

### ⚠️ One decision needed before Chunk 3

Your ask includes: *"make sure that whichever skills added need to be ATS score calculation considered and that score need to be higher, not lower at all."* The Falood chatbot studio has **no scoring engine at all** today — no ATS/Recruiter/Role-fit/Truth score, no page-fit metric. The scores in your second screenshot come from a completely different system: the 4-agent AI pipeline's Hiring Panel + Final Polish (`application-queue` review UI), which Falood's chatbot studio doesn't call and was never wired to.

Two ways to satisfy "score must go up, never down":
- **(A) Lightweight, Falood-local scoring** — a simple deterministic keyword-match score (does the tailored resume's skill list now cover more of the JD's extracted required/preferred skills than before) computed in-process, no AI call, cheap and fast, but not the same rigor as the pipeline's Hiring Panel.
- **(B) Reuse the pipeline's real scoring** — call into the same Hiring Panel-style logic the 4-agent pipeline uses, giving genuinely equivalent rigor, but that's a real cross-system integration (Falood chatbot studio and the 4-agent pipeline are architecturally separate today, confirmed via `openStudio.ts`'s own comments), a bigger lift than this feature's other pieces.

I'd lean toward (A) as the MVP (matches "keyword coverage should provably increase," cheap, no new AI cost) with (B) as a later upgrade if the lighter version isn't convincing enough — but this is a real product/quality-bar decision, not a code detail, worth confirming before Chunk 3 starts.
yes you can proceed with plan (A)

---

### Chunk 1 — Skill-gap detection (deterministic, no new AI call)

**Files:** new `src/lib/falood/skillGapDetector.ts`

Given: the tailored resume's current skills, the JD's extracted skills (reuse the existing `extract-skills` call — already returns `skills: string[]` from the JD), and the candidate's base resume skills (already loaded via `buildCandidateContext`'s query, just need the flat skill list alongside the full context string it currently returns).

Compute: skills present in **JD or base resume** but **absent from the tailored resume** (case-insensitive, trimmed match — same normalization style already used elsewhere in this codebase, e.g. `applySuggestionToResumeData`'s `normalize()` helper). Output: an ordered list of individual missing skills, most JD-relevant first (skills that appear in both JD *and* base resume rank above skills only in one). 

Comment:Here also make sure that souce of truth - skills also makes consider.

No AI call needed for this chunk — it's a set-difference over data already being fetched.

### Chunk 2 — One-suggestion-per-skill, queued delivery

**Files:** `faloodAiService.ts` (prompt/output shape), `AiSuggestions.tsx` (chat UI)

- Change the system prompt's `"skill"` type contract: when suggesting *new* skills to add (as opposed to a user-requested bulk reorg, which stays as-is), emit **one suggestion object per skill**, each with `suggested: [singleSkill]`.
- On the resume being saved/finalized (see Chunk 4 for the trigger), run Chunk 1's gap list through this and queue the resulting one-skill-per-suggestion messages into the chat, but only **reveal one at a time** — the next queued suggestion only appears after the current one is accepted or rejected. This is a client-side queue in `AiSuggestions.tsx`'s state, not a server change: the suggestions already exist as accept/reject items, this only changes how many are visible at once.

### Chunk 3 — Score-must-not-decrease guard

**Depends on the Part 2 decision above.**

Before a skill-gap suggestion is queued, verify it would help, not hurt: with option (A), compute the deterministic JD-keyword-coverage score before and after hypothetically adding the skill; only queue suggestions where coverage strictly increases (a skill already effectively covered by a synonym already on the resume gets skipped, not suggested pointlessly). Same reporting channel pattern used elsewhere in this codebase (Job Lens/Hiring Panel's warnings) — don't invent a new one.

### Chunk 4 — Trigger point

*"after made the tailored resume, it should also give some default messages"* — run Chunk 1+2's queued-suggestion flow automatically once, right after a tailored resume is first saved (`persistTailoredApplication` in the tailor studio page, or the "Save as Version" action) — seeded as the next assistant message in chat, not requiring the user to ask for it. Needs a one-time guard (e.g. a flag on the session, or checking `chatHistory` for a marker message) so it doesn't re-trigger on every subsequent save.

### Chunk 5 — Persistence check (likely no schema change needed)

`falood_saved_applications.chat_history` already persists every suggestion and its `status` (`accepted`/`rejected`/`pending`) as part of the normal save flow — a rejected or accepted skill-gap suggestion is automatically remembered and won't be re-suggested on reload, for free. Verify this holds once Chunk 2's one-per-skill suggestions exist (more suggestion objects than before, same persistence path) rather than assuming — but this chunk is verification, not new database work.

---

## Testing standard (same bar as the 4-agent pipeline plan)

- Real candidate, real tailored resume, real JD with a known, deliberate skill gap — not synthetic fixtures.
- Confirm exactly one suggestion is visible at a time, in the UI, not just in the API response.
- Confirm accepting one skill doesn't also silently apply others still queued.
- Confirm the score-guard (Chunk 3) actually blocks a skill that wouldn't help, not just ones that would.
- `npm run test` full suite, zero regressions, before considering any chunk done.

comment: use "Istiaque Uddin Hyder (Shohan)" candidate for testing.

## AI credit cost

Chunk 1 (detection): 0 new AI calls — reuses the existing extract-skills call, which already runs today.
Chunk 2 (one-per-skill suggestions): 0 new AI calls — same suggestion-generation call, different output shape.
Chunk 3 (score guard, option A): 0 new AI calls — deterministic.
Chunk 4 (trigger): 0 new AI calls — fires the existing suggestion flow once, automatically, instead of waiting for a user prompt.

Net: this reshapes and better-times AI calls the app already makes; it does not add new ones in the common case.
