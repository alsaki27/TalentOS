# TalentOS Job Capture Extension — Implementation Plan

A Chrome MV3 extension that captures job postings from LinkedIn, Indeed, and any generic job board, sends them into TalentOS, and falls back to the existing crawler when in-page DOM extraction fails.

Modeled on the existing Skarion CRM `LinkedIn Profile Capture v6.0.3` extension (same manifest shape, same side-panel UX, same Bearer-key settings pattern).

---

## What already exists (do NOT rebuild)

| Piece | Where | Status |
|---|---|---|
| Extension API auth (`tos_` Bearer keys, scopes, CORS, idempotency, revocation) | `src/lib/extensionAuth.ts` | Done |
| `extension:job:capture` scope | `EXTENSION_SCOPES.jobCapture` | Done |
| Job capture endpoint | `src/app/api/extension/v1/capture-job/route.ts` | Done, needs extending (see B1) |
| `extension_api_keys` table + key management UI | `/settings/api-keys` | Done |
| Middleware bypass for `/api/extension/v1/*` | `src/middleware.ts` → `isExtensionApiPath()` | Done |
| Crawler ingestion + heartbeat + live SSE status | `src/app/api/integrations/crawler/*`, `src/lib/integrations/jobCrawler.ts` | Done |
| Keyless page fetch w/ JS rendering (Jina → Jina no-cache → direct HTTP + JSON-LD) | `src/lib/ai/job-agents/fetchJobPage.ts` | Done |
| AI JD structuring (Deep Fetch) | `buildDeepFetchPrompt` + `job_ceo_deep_fetch` automation | Done |

**Implication:** the extension can talk to `/api/extension/v1/capture-job` on day one with zero backend changes. Backend work below is for the fallback path and multi-candidate support.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ CHROME EXTENSION (MV3, side panel)                          │
│                                                             │
│  content.js — per-site adapters, in priority order:         │
│    1. JSON-LD JobPosting  (schema.org — works on ~60% of    │
│       boards incl. most ATS: Greenhouse, Lever, Ashby)      │
│    2. Site adapter        (LinkedIn / Indeed hand-tuned)    │
│    3. Generic heuristic   (largest text block + <h1>)       │
│                                                             │
│  Confidence score per capture → decides local vs. fallback  │
└──────────────────────┬──────────────────────────────────────┘
                       │ POST /api/extension/v1/capture-job
                       │ Authorization: Bearer tos_...
                       │ X-TalentOS-Client, Idempotency-Key
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ TALENTOS BACKEND                                            │
│                                                             │
│  capture-job route:                                         │
│    ├─ confidence OK  → insert into jobs (source=extension)  │
│    └─ confidence LOW → enqueue for server-side recovery ────┼──┐
│                                                             │  │
│  NEW: /api/extension/v1/recover-job (server-side)           │◄─┘
│    ├─ fetchJobPageText(url)   ← existing, keyless, JS-aware │
│    ├─ Deep Fetch AI prompt    ← existing automation         │
│    └─ patch the jobs row, mark recovered                    │
│                                                             │
│  Still failing? → hand URL to the external crawler bot      │
│     (job_crawler_queue → bot polls → pushes back via        │
│      /api/integrations/crawler/jobs)                        │
└─────────────────────────────────────────────────────────────┘
```

**Key design decision:** three escalating tiers, cheapest first.
1. **In-page DOM** (free, instant, has the user's logged-in session — this is the extension's whole advantage: it sees LinkedIn/Indeed pages that a server fetch cannot).
2. **Server-side Jina + AI** (free-ish, ~2–6s, handles JS-heavy pages the DOM adapter mis-parsed).
3. **Crawler bot** (slowest, for pages that block both — hard anti-bot, multi-step nav).

---

## Chunk A — Extension (no backend dependency, start here)

### A1. Scaffold
Copy the CRM extension's structure exactly — it's proven:
- `manifest.json` (MV3, `side_panel`, `storage`, `activeTab`, `scripting`, `tabs`)
- `background.js` — badge state + "open TalentOS record" tab reuse
- `popup.html` / `popup.js` — side panel UI + settings (TalentOS URL + `tos_` API key in `chrome.storage.local`)
- `content.js` — extraction

**Host permissions:**
```json
"host_permissions": [
  "https://www.linkedin.com/*",
  "https://*.indeed.com/*",
  "https://*.workers.dev/*",
  "http://localhost:*/*",
  "<all_urls>"
]
```
`<all_urls>` is what enables the "any generic job board" requirement. Flag for review: this triggers a stricter Chrome Web Store review. If that's a problem, ship with an explicit board list + `optional_host_permissions` for user-granted sites instead.

### A2. Extraction strategy (`content.js`)

**Tier 1 — JSON-LD (try first, always).** Most boards and every major ATS emit `schema.org/JobPosting`:
```js
document.querySelectorAll('script[type="application/ld+json"]')
// → @type === "JobPosting" → title, hiringOrganization, jobLocation,
//   description, datePosted, baseSalary, employmentType
```
This is the single highest-leverage piece — reuse the parsing logic already in `fetchJobPage.ts`'s `extractJsonLd()` so client and server agree.

**Tier 2 — Site adapters.** Hand-tuned selectors per site, in a registry so adding a board is one object, not a code change:
```js
const ADAPTERS = [
  { match: /linkedin\.com\/jobs/, extract: extractLinkedIn },
  { match: /indeed\.com\/(viewjob|jobs)/, extract: extractIndeed },
  // ...
];
```
LinkedIn/Indeed both lazy-render — **reuse the CRM extension's `scrollAndCapture()` + `clickExpanders()` logic verbatim**, it already solves exactly this (stability detection, "see more" expansion, max-round cap).

**Tier 3 — Generic heuristic.** Largest contiguous text block + nearest `<h1>` + `<title>`. Deliberately low-confidence; expected to trigger the server fallback often. That's fine — it's the safety net, not the primary path.

### A3. Confidence scoring
Every capture returns a score; this is what drives the fallback decision:
```js
{
  confidence: 0-100,
  method: 'jsonld' | 'adapter' | 'generic',
  fields: { title: bool, company: bool, jdText: bool, applyUrl: bool }
}
```
Suggested rule (tune after real use): `jsonld` → 90+; `adapter` w/ all 4 fields → 75; `generic` → ≤40. Anything under ~60, or `jdText` shorter than ~200 chars, sends `needsRecovery: true`.

### A4. UX
Side panel, mirroring the CRM extension's flow:
- Auto-detects "this looks like a job page," shows extracted preview (title/company/location + JD char count)
- Primary action: **Capture Job**
- Optional: assign to a candidate at capture time (needs B2)
- Progress bar reusing the CRM extension's `reportProgress` message pattern
- On success: link to the created job in TalentOS (reuse `openCrmRecord`-style tab reuse from `background.js`)

---

## Chunk B — Backend additions

### B1. Extend `capture-job` (small, safe)
Current route takes `{title, applyUrl, jdText, ...}` and requires all three. Add:
- `confidence`, `captureMethod`, `needsRecovery` → persist to `raw_source_payload`
- Relax validation: allow a capture with `applyUrl` but weak/missing `jdText` **if** `needsRecovery: true` (that's the whole point of the fallback)
- Return `{ jobId, duplicate, recoveryQueued }`
- Keep the existing `apply_url` dedup

### B2. Candidate assignment at capture (optional, nice-to-have)
`extension_api_keys.candidate_id` already exists on the key row but the capture route ignores it. Wire it through so a capture can immediately create the `target_jobs` / application link, instead of requiring a separate step in the web UI.

### B3. NEW: `/api/extension/v1/recover-job`
The heart of the fallback. Given `{ jobId }`:
1. `fetchJobPageText(job.apply_url)` — **already built**, keyless, 3-layer (Jina JS-wait → Jina no-cache → direct HTTP w/ JSON-LD extraction), plus SSRF guards (`isSafeExternalUrl`)
2. Feed result to `buildDeepFetchPrompt` via `callWithUsageTracking("job_ceo_deep_fetch", ...)` — **already built**
3. Patch `jobs` row with `description_text` + structured requirements
4. If step 1 returns empty → enqueue to `job_crawler_queue` (B4)

Run this in the background (`backgroundDispatch` + `waitUntil`, same pattern as the workflow dispatcher) so the extension isn't blocked on a 6s AI call.

### B4. NEW: `job_crawler_queue` table + poll endpoint
Currently the crawler bot only **pushes** — there's no way to ask it to fetch a specific URL. Add:
```sql
CREATE TABLE job_crawler_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending|claimed|done|failed
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```
Plus `GET /api/integrations/crawler/queue` (bot claims work, `CRAWLER_API_KEY`-gated, same auth as existing crawler routes). Bot pushes results back through the **existing** `/api/integrations/crawler/jobs` — no change needed there.

Cap `attempts` at 3 so a permanently-blocked URL doesn't retry forever (same reasoning as the enricher's existing 3-attempt cap).

---

## Chunk C — Ops

### C1. Capture telemetry
Add `extension_capture_events` (or reuse `ai_usage_events`'s shape): site, method, confidence, recovered?, final success?. Without this you can't answer "which boards is the extension bad at" — which is exactly what tells you where to add a Tier-2 adapter next.

### C2. Extension key provisioning
`/settings/api-keys` exists; confirm it can mint keys with the `extension:job:capture` scope and (for B2) bind a `candidate_id`.

### C3. Live capture feed (optional)
The crawler SSE stream (`/api/integrations/crawler/stream`) already polls for `source='crawler'` jobs. Extend to `source='extension'` for a live "jobs captured" view.

---

## Build order

| Phase | Work | Dependency |
|---|---|---|
| 1 | A1 scaffold + A2 Tier 1 (JSON-LD only) + settings UI | none — existing capture-job endpoint works as-is |
| 2 | A2 Tier 2 LinkedIn + Indeed adapters, A3 confidence, A4 UX | phase 1 |
| 3 | B1 capture-job extension, B3 recover-job | phase 2 (needs real confidence data) |
| 4 | B4 crawler queue + poll endpoint | B3 |
| 5 | A2 Tier 3 generic, C1 telemetry | phase 3 |
| 6 | B2 candidate assignment, C3 live feed | anytime after phase 3 |

Phase 1 is genuinely shippable alone — JSON-LD covers most ATS boards, and the endpoint it posts to already exists.

---

## Open questions

1. **`<all_urls>` vs. explicit board list** — affects Chrome Web Store review difficulty. Recommend starting with an explicit list + `optional_host_permissions`, adding `<all_urls>` only if the generic tier proves valuable.
2. **Who owns the crawler bot?** B4 requires a change on the bot side (poll a queue, not just push). Confirm that's in scope and who does it.
3. **Distribution** — Web Store listing, or unpacked/enterprise-policy install like the CRM extension appears to be? Affects whether `<all_urls>` matters at all.
4. **Candidate binding** — should a key be per-recruiter (capture into a shared pool) or per-candidate? `extension_api_keys.candidate_id` supports either; pick before B2.
