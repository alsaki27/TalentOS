# TalentOS Email Intelligence System — End-to-End QA Report (2026-08-20)

**Method:** Read-only where possible. Created one temporary, clearly-labeled QA staff account (`qa-test-claude@talentos.local`, `application_engineer` role), logged in through the real auth flow, and drove the live production site (`https://talent.skarion.com`) with a headless Chromium browser (Playwright), taking screenshots and capturing console/network errors at every step. Cross-verified every claim against the actual source code and the live database. The test account was deleted at the end of this pass. **Never exercised**: actually sending an email, approving/rejecting a real application, or disconnecting a real candidate's Gmail — those would have real, external, hard-to-reverse side effects on real people's data.

---

## 🔴 Critical — found while testing, not part of the original ask

### `GET /api/candidates` has no authentication check at all

Confirmed with a bare `curl` request — no cookies, no auth header, nothing:

```
curl "https://talent.skarion.com/api/candidates?compact=1&pageSize=3"
→ HTTP 200, real data: candidate names, IDs, and direct SharePoint resume document links, for all 21 candidates in the system.
```

`src/app/api/candidates/route.ts`'s `GET` handler has no `requireCurrentUser()` call anywhere — every other verb on the same file (`POST`) is correctly guarded, `GET` simply isn't. Anyone who knows or guesses this URL can read every candidate's real name and a link to their actual resume document, no login required.

**A bounded pattern search** (`grep` for `requireCurrentUser`/known alternate auth helpers) turned up ~15-20 other staff-facing-looking routes with the same shape — `applications/route.ts`, `applications/[id]/route.ts`, `bulk/route.ts` (this one is **write-capable** — bulk status changes — if genuinely unauthenticated, that's more severe than a read leak), `analytics/route.ts`, `candidate-dashboard/route.ts`, `follow-ups/route.ts`, `ats-score/*`, `candidates/[id]/resume(s)/route.ts`, `candidates/[id]/photo/route.ts`, `integrations/gmail/status/route.ts`, `job-ceo/*`. **These are not individually confirmed** — the search method has real false-positive sources (the `public/*`, `auth/*`, `portal/*`, and `webhooks/*` trees are legitimately unauthenticated or use a different, correctly-scoped session mechanism my grep pattern doesn't recognize, and were excluded from this list). Treat this as "worth checking next," not a confirmed list — `/api/candidates` is the one I have hard proof on.

**Recommendation:** fix `/api/candidates` GET immediately (one-line: add the same `requireCurrentUser()` guard every other route in this codebase uses), then do a deliberate pass over the flagged list.

---

## 🔴 Critical — directly in scope

### `POST /api/inbox/send` will fail every single time it's called

```ts
// src/app/api/inbox/send/route.ts, line 22-23
const account = await queryOne<{ refresh_token: string; gmail_email: string }>(
  `SELECT refresh_token, integration_email as gmail_email FROM integration_accounts WHERE ...`,
```

Confirmed directly against the live database schema: `integration_accounts` has a column named **`email`**, not `integration_email`. This query throws a Postgres "column does not exist" error every time. The "send a reply from the candidate's own Gmail" feature — the plan's explicitly stated MVP outcome — is completely non-functional right now. One-line fix: `email as gmail_email`.

`POST /api/inbox/drafts` (the Gmail-draft-sync path) does **not** have this bug — it only selects `refresh_token`, never touches this column. Confirmed correct on read-through.

---

## ✅ Confirmed working

| Item | How verified |
|---|---|
| All 7 chunks' files/tables actually exist (not just planned) | Direct file existence + DB schema checks: `gmailApi.ts` functions, `inbox_drafts` table (all 14 columns match spec), all 3 new API routes, all 3 new UI components, `inbox/layout.tsx` |
| `/api/inbox/counts` returns `drafts`/`handovers` fields correctly | Read the live route code — correct, efficient, parameterized `COUNT(*) FILTER` queries |
| **Drafts tab `[object Object]` bug — genuinely fixed** | Live screenshot: clean "Drafts" label, "No drafts found." empty state |
| **Handovers `assigned_to_user_id` column bug — genuinely fixed** | Live screenshot: loads with "No handovers assigned to you.", no DB error; confirmed the column exists in `action_items` |
| Full test suite | `npm run test`: **43 files, 283 passed, 6 skipped, 0 failed** (exceeds the plan's stated 278) |
| `npm run typecheck` | Clean |
| 4-tab page structure (Inbox / Approvals / Drafts / My Handovers) | Renders and is navigable — confirmed live |
| `CandidateGmailSelector.tsx` component logic itself | Code-reviewed: correctly sorts connected-first, correct 🟢/Connected/Disconnect UI logic. The bug below is upstream of this component, not in it |
| Overall dark-mode theme | Screenshots show a clean, consistent dark UI throughout |

---

## 🟠 Confirmed broken / suspicious (blocks most of the manual testing guide)

### The candidate selector never populates — everything downstream is blocked by this

`inbox/page.tsx` fetches `/api/candidates?compact=1&pageSize=500` on load and silently swallows any failure (`.catch(() => {})`, no error shown to the user). Directly probing this exact call:

```
Attempt 1 (curl, pageSize=500→capped to 200 server-side): 0.97s, HTTP 200, correct data
Attempt 2 (curl, pageSize=10):                             12.57s, HTTP 200
Attempt 3 (Playwright request, same session, pageSize=500): >30s, full timeout, no response at all
```

Wildly inconsistent latency for a table with only 21 rows. I was not able to pin down the exact cause (Neon connection cold-start variance is a plausible contributor, but I can't rule out something else without deeper investigation than this pass covered) — but the practical effect, reproduced twice with a 15-second explicit wait: **the candidate dropdown never populates**, "Loading mailbox..." never resolves, and the page is stuck showing "0 conversations" — even when I forced a known-good `candidateId` (one confirmed via direct DB query to have both Gmail connected and a real pending approval) into the URL.

Because of this, I could not get far enough into a real, populated session to visually verify:
- Section 1's 🟢/(Connected) badge rendering (the code is correct; I just never saw it render against real data)
- Section 2's filtering behavior with real mail
- Section 3's "Show Details" modal (no approval card ever rendered to click it on)
- Section 4's email body formatting
- Section 5's status-change links and Approve feedback
- Section 6's pagination controls (never appeared — consistent with "0 conversations" the whole time, not a separately confirmed pagination bug)

**This is the highest-priority functional bug to chase down** — until it's fixed, essentially none of the new Inbox UI is usable for a real AE, regardless of how correct the rest of the implementation is.

---

## ⚪ Not exercised (would have had a real, external, hard-to-reverse effect)

- Actually clicking **Send** on a reply (would send a real email from a real candidate's Gmail to a real recipient) — moot right now anyway given the confirmed backend bug above, but worth re-testing once fixed.
- Actually clicking **Approve/Reject** on a real pending approval (would change a real application's status) — 5 real pending approvals exist in the system right now if you want to test this yourself; I left them untouched.
- File attachment upload-and-send.
- Gmail-native draft sync (would need to check a real candidate's actual Gmail Drafts folder).
- Disconnect Gmail on a real candidate.

---

## Recommended order of fixes

1. **`/api/candidates` auth gap** — real PII exposure, fix immediately regardless of anything else.
2. **`/api/inbox/send` column name** — one line, unblocks the entire Send feature.
3. **Candidate-list load reliability** — the whole redesigned Inbox is unusable until this is solved; needs its own investigation into why `/api/candidates` latency is so inconsistent.
4. Re-run this exact QA pass once 1-3 are fixed to actually exercise Sections 1-6 of the testing guide with real data.
5. Individually verify the other flagged routes from the security sweep.
