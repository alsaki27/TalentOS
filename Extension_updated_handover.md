# Extension Integration Handover — July 15, 2026

> **Project:** TalentOS / Skarion Tracker  
> **Branch:** `istiaque-updates`  
> **Live URL:** `https://skarion-talent-os.skarion-talentos.workers.dev`  
> **Dev URL:** `http://localhost:3000`  
> **Extensions:** `C:\Shohan\Skarion\TalentOS-Extensions\TalentOS-Extensions\`

---

## 1. What Was Built

Three Chrome MV3 browser extensions were integrated end-to-end with the TalentOS project using the Extension API Key system (`/admin/extension-keys`). All extensions now call TalentOS through `/api/extension/v1/*` endpoints, using Bearer `tos_...` tokens for authentication.

| Extension | Purpose | v |
|-----------|---------|---|
| **Job Capture** | Scrape job postings from any site and save them to TalentOS `/jobs` | 0.3.0 |
| **Resume QA** | Check your resume readiness against a job description before applying | 0.3.0 |
| **Apply Copilot** | Auto-fill ATS application forms (name, email, resume upload, etc.) — never submits | 0.3.0 |

---

## 2. Extension Workflows

### 2.1 Job Capture

```
User clicks icon on any job page
    │
    ▼
content.js extracts: title, company, location, applyUrl, jdText, salary, sourceSite, ATS detected
    │
    ▼
chrome.runtime.sendMessage → background.js
    │
    ▼
POST /api/extension/v1/capture-job     Auth: Bearer tos_...
    │  body: { title, company, location, jdText, applyUrl, salary, atsDetected }
    ▼
TalentOS inserts into jobs table (source = "extension")
    │
    ▼
Badge: "OK" (green) / "DUP" (yellow) / "ERR" (red)
Toast + preview card with job details
```

**Key behaviors:**
- Deduplicates by `apply_url` — if job already exists, returns existing `jobId` with `duplicate: true`
- Stores `atsDetected` in `jobs.notes` column
- Candidate ID is **optional** in Options (job capture doesn't need one)
- History of last 20 captures shown in Options page

### 2.2 Resume QA

```
User clicks icon on any JD page
    │
    ▼
content.js extracts job description text
    │
    ▼
chrome.runtime.sendMessage → background.js
    │
    ▼
POST /api/extension/v1/readiness/preview    Auth: Bearer tos_...
    │  body: { jdText, candidateId }
    ▼
TalentOS pulls data from 3 sources:
    ├─ candidates.verified_skills (manually verified skills)
    ├─ candidate_evidence.related_skills (evidence-backed skills)
    └─ resumes.parsed_json.skills (extracted from uploaded resume PDF)
    │
    ▼
Readiness engine computes:
    required = candidate_skills ∩ jd_keywords
    matched  = required ∩ evidenced_skills
    missing  = required − matched
    flagged  = claimed − evidenced
    score    = round(100 × |matched| / |required|)
    │
    ▼
Panel shows: score (%), progress bar, matched/missing/flagged items
    │  "threshold: 70% · 12 resume skills"
    ▼
"+ evidence" button for each flagged/missing skill stores notes locally
```

**Key behaviors:**
- API key must be bound to a candidate, OR candidateId passed from Options as fallback
- If candidate has no skills/resume data, warning banner shows: *"No skills data found for this candidate"*
- Works on any job page (LinkedIn, Greenhouse, Lever, etc.)
- Local evidence notes stored in `chrome.storage.local` (not synced to TalentOS for this version)

### 2.3 Apply Copilot

```
User navigates to ATS application page (e.g. greenhouse.io)
    │
    ▼
Clicks copilot icon
    │
    ▼
background.js:
    1. GET /queue/next?candidateId=...         → ticket with application, job, profile
    2. GET /candidate/resumes?candidateId=...   → list of uploaded resumes
    3. GET /adapters/manifest                   → ATS adapter list with maturity
    4. detectATS(applyUrl hostname)             → e.g. "greenhouse"
    5. Checks adapter exists and is known
    │
    ▼
Injects copilot.js with { ticket, adapterName, resumes, adapterMaturity }
    │
    ▼
SUMMARY CARD shows:
    ┌─────────────────────────────────┐
    │ Job Title · Company · Adapter   │
    │ Candidate: Name / Email         │
    │ Adapter: greenhouse (verified)  │
    │                                 │
    │ Select Resume for Upload        │
    │ [resume-2026.pdf       ▼     ]  │
    │                                 │
    │ [Cancel]    [Fill Application]  │
    │ Never submits for you           │
    └─────────────────────────────────┘
    │
    ▼
User picks resume, clicks "Fill Application"
    │
    ▼
copilot.js fills the ATS form:
    ├─ Text/Select inputs: name, email, phone, location, linkedin, portfolio
    │   → sets value, dispatches "input" + "change" events
    │
    └─ File input (resume):
        → sends downloadResume message to background
        → background calls GET /resume-download?url=... (TalentOS proxy)
        → converts ArrayBuffer → File → DataTransfer → input.files
        → dispatches "change" event
        → marks status "filled" or "blocked"
    │
    ▼
Installs submit evidence listener (form submit → screenshot + POST /evidence)
    │
    ▼
REVIEW PANEL shows:
    ┌─────────────────────────────────┐
    │ ✓ 5 filled   ~ 1 uncertain     │
    │ ✗ 1 unknown  ⚠ 1 blocked      │
    │                                 │
    │ ✓ Name    John Doe             │
    │ ✓ Email   john@email.com       │
    │ ✓ Resume  resume.pdf 📄        │
    │ ~ Phone   555-0123             │
    │ ✗ Linked  —                   │
    │ ⚠ Upload  blocked (manual)     │
    │                                 │
    │ ⚠ Review before submitting     │
    └─────────────────────────────────┘
    │
    ▼
USER manually reviews everything, edits if needed, clicks SUBMIT on the ATS site
    │
    ▼
Submit triggers evidence listener:
    → chrome.tabs.captureVisibleTab (PNG screenshot)
    → POST /evidence { applicationId, screenshotUrl, confirmationScrape }
    → Stored in application_evidence table
```

**Key behaviors:**
- Never auto-submits — you must manually click the ATS submit button
- Resume is explicitly selected from your TalentOS uploads (not auto-picked)
- Draft adapters (lever, ashby, workday, icims) still fill but show yellow ⚠ warning
- File upload blocked by site security → marked "blocked" in review, user uploads manually
- Green badge "OK" on successful fill, error message on failure
- Requires `applications` row with `status = 'assigned'` AND `review_status = 'approved'` in DB

---

## 3. TalentOS Server Changes

### 3.1 CORS Middleware (`src/middleware.ts`)

**Why:** Chrome extensions send requests from `chrome-extension://` origin with `Authorization`, `X-TalentOS-Client`, `Idempotency-Key` headers. These trigger CORS preflight (OPTIONS) requests that must be answered.

**What:** Added `getExtensionCorsResponse()` function called when `pathname.startsWith("/api/extension/v1/")`:

- On `OPTIONS`: returns `204` with CORS headers
- On other methods: lets request pass through but adds CORS headers to the response

Headers set:
```
Access-Control-Allow-Origin: <echo request Origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key, X-TalentOS-Client
Access-Control-Allow-Credentials: true
```

### 3.2 New Scope: `extension:resume:read`

**Files changed:**
- `src/lib/extensionAuth.ts` — added `resumeRead: "extension:resume:read"` to `EXTENSION_SCOPES`
- `src/app/api/admin/extension-keys/route.ts` — added to `VALID_SCOPES`
- `src/app/admin/extension-keys/page.tsx` — added "Resume Read" checkbox in UI

### 3.3 New Endpoint: Candidate Resumes List

**File:** `src/app/api/extension/v1/candidate/resumes/route.ts` (NEW)  
**Method:** GET  
**Scope:** `extension:resume:read`  
**Query:** `?candidateId=<uuid>`

Returns the candidate's uploaded resumes:
```json
{
  "resumes": [
    {
      "id": "uuid",
      "fileName": "resume-2026.pdf",
      "fileUrl": "https://storage.example.com/...",
      "isOriginalUpload": true,
      "createdAt": "2026-07-15T..."
    }
  ]
}
```

### 3.4 New Endpoint: Resume Download Proxy

**File:** `src/app/api/extension/v1/resume-download/route.ts` (NEW)  
**Method:** GET  
**Scope:** `extension:resume:read`  
**Query:** `?url=<fileUrl>`

Proxies the resume file download from storage to the extension. Avoids CORS and host-permission issues. Fetches the file server-side and streams it back with `Content-Disposition: attachment`.

### 3.5 Readiness Preview — Now Pulls Resume Skills

**File:** `src/app/api/extension/v1/readiness/preview/route.ts` (UPDATED)

Previously only used `candidates.verified_skills` and `candidate_evidence.related_skills`. Now also queries `resumes.parsed_json.skills` (skills extracted from uploaded resume PDF by the AI parser) and includes them in the readiness computation.

Added `extractResumeSkills()` helper that splits category-tagged strings like `"OSP & Engineering: AutoCAD, FTTx"` into individual tokens (`OSP`, `Engineering`, `AutoCAD`, `FTTx`).

Response now includes:
```json
{
  "score": 65,
  "threshold": 70,
  "matched": ["react", "typescript"],
  "missing": ["aws"],
  "flagged": [],
  "resumeSkillsFound": 24,
  "totalEvidenceSources": 30
}
```

### 3.6 Readiness Per Application — Same Update

**File:** `src/app/api/extension/v1/readiness/[applicationId]/route.ts` (UPDATED)  
Same resume skills extraction as the preview endpoint.

### 3.7 Adapter Manifest — Maturity Fixed

**File:** `src/app/api/extension/v1/adapters/manifest/route.ts` (UPDATED)

Changed `greenhouse` maturity from `"draft"` to `"verified"` to match the working embedded adapter. Other adapters remain `"draft"` (lever, ashby) or `"draft"` with `checksum: "stub"` (workday, icims).

### 3.8 Queue/Next — Location Column Fix

**File:** `src/app/api/extension/v1/queue/next/route.ts` (UPDATED)

The `candidates` table has `city`, `country`, `location_preference` but NOT a `location` column. Changed SQL to:

```sql
COALESCE(
  NULLIF(TRIM(COALESCE(c.city,'') || ', ' || COALESCE(c.country,'')), ''),
  c.location_preference
) AS location
```

All 8 extension routes are now CORS-wrapped with `withExtensionCors()`.

---

## 4. Extension File Changes (All 3 Extensions)

Every extension was **completely rewritten** from minified/bundled IIFE JS to clean, readable, maintainable JavaScript. All use a single `chrome.runtime.onMessage.addListener` pattern to avoid MV3 async listener conflicts.

### 4.1 Shared Changes (all 3 extensions)

| Change | Detail |
|--------|--------|
| Default API base URL | `http://localhost:3000/api/extension/v1` (was `localhost:4114`) |
| Options placeholder/hint | Shows local and live URL examples |
| URL normalization | `normalizeBaseUrl()` prepends `http://` if missing, applied before save/read/fetch |
| Test Connection | Routed through background.js to avoid CORS (options page can't cross-origin fetch) |
| Single message listener | All message handlers consolidated into one listener per extension (prevents async return-value conflicts) |
| Version | All bumped to 0.3.0 |
| ApiError handling | Consistent error serialization with code/status/message |
| Idempotency-Key | Auto-generated for all POST requests |

### 4.2 extension-job-capture

| File | Changes |
|------|---------|
| `background.js` | Full rewrite: apiClient, captureJob, postEvidence, captureHistory, badge, testConnection handler, single message listener, **ADDED `chrome.action.onClicked`** to inject content.js |
| `content.js` | Full rewrite: JD extraction, toast/preview UI, shadow DOM preview card |
| `options.js` | Full rewrite: auth helpers, normalizeBaseUrl, test via background, **candidateId now optional** (removed validation) |
| `options.html` | Updated placeholder, hints, and version label; candidate ID field marked "optional" |

### 4.3 extension-qa

| File | Changes |
|------|---------|
| `background.js` | Full rewrite: apiClient, previewReadiness, testConnection handler, **reads candidateId from storage as fallback** for readiness call, icon onClick injector, single message listener |
| `content.js` | Full rewrite: JD extraction, toast/panel UI, shadow DOM readiness panel, **resume skills count displayed** in header, **empty-data warning** when no skills found, local evidence note storage |
| `options.js` | Full rewrite: auth helpers, normalizeBaseUrl, test via background |
| `options.html` | Updated placeholder, hints, version |

### 4.4 extension-copilot

| File | Changes |
|------|---------|
| `background.js` | Full rewrite: apiClient, getNextQueueItem, getCandidateResumes, downloadResumeUrl, getAdaptersManifest, postEvidence, detectATS, requireProfile, injectMessage, **resume list fetch**, **does NOT hard-block draft adapters**, **friendlyError for queue_empty**, icon onClick handler, single message listener |
| `copilot.js` | Full rewrite: embedded ATS adapters (greenhouse→verified, others→draft), fillFields, applyFill, **resume file upload via DataTransfer**, **resume picker dropdown in summary card**, installEvidenceListener, review panel with filled/uncertain/unknown/blocked stats, **draft adapter warning**, error panel |
| `options.js` | Full rewrite: auth helpers, normalizeBaseUrl, test via background, candidateId still required |
| `options.html` | Updated placeholder, hints, version |

---

## 5. Key Architectural Decisions

### 5.1 Base URL Includes `/api/extension/v1`
Rather than having each endpoint include `api/extension/v1` in its path, the base URL includes the full prefix. This means endpoints are called as `/capture-job`, `/queue/next`, etc. and the base URL can be swapped between local and live easily.

### 5.2 Single Message Listener per Extension
MV3 Chrome extensions have a subtle rule: if `onMessage.addListener` returns a Promise (from an `async` function), Chrome treats it as an async handler that will call `sendResponse`, even if the handler didn't match the message. Multiple async listeners block each other. Solution: one listener per extension with an `if/else` chain.

### 5.3 Test Connection via Background
Extension options pages (`options.html`) cannot make cross-origin fetch requests without `host_permissions`. Background service workers can. Solution: options page sends `{ action: "testConnection", base, key }` to background, background does the fetch, returns result.

### 5.4 URL Normalization Everywhere
If a user types `localhost:3000/api/extension/v1` (without `http://`), the fetch fails because `localhost` is treated as a URL scheme. `normalizeBaseUrl()` at the options level and inline checks in background handlers ensure the URL always has a protocol.

### 5.5 Resume Upload via Proxy → DataTransfer
The copilot's `applyFill` for file inputs:
1. Sends a `downloadResume` message to background
2. Background calls `GET /resume-download?url=...` through the TalentOS proxy
3. Converts `ArrayBuffer` to `File` using `new File([buffer], name, { type })`
4. Creates `DataTransfer`, adds file, assigns `input.files = dt.files`
5. Dispatches `change` event

If the site blocks programmatic file selection, the field is marked `"blocked"` in the review panel and the user uploads manually.

---

## 6. API Key Setup Guide

### 6.1 Server Setup

1. Start TalentOS dev: `cd C:\Shohan\Skarion\TalentOS && npm run dev`
2. Go to `http://localhost:3000/admin/extension-keys` (login as admin)
3. Create API keys:

| Label | Scopes | Candidate Binding |
|-------|--------|------------------|
| job-capture-key | `extension:job:capture`, `extension:adapters:read` | Optional |
| qa-key | `extension:readiness:read`, `extension:adapters:read` | Required (or enter in Options) |
| copilot-key | `extension:queue:read`, `extension:readiness:read`, `extension:evidence:write`, `extension:adapters:read`, `extension:resume:read` | Required |

4. **Save each generated key** — shown only once.

### 6.2 Load Extensions in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** for each:
   - `C:\Shohan\Skarion\TalentOS-Extensions\TalentOS-Extensions\extension-job-capture`
   - `C:\Shohan\Skarion\TalentOS-Extensions\TalentOS-Extensions\extension-qa`
   - `C:\Shohan\Skarion\TalentOS-Extensions\TalentOS-Extensions\extension-copilot`

### 6.3 Configure Each Extension

Right-click icon → **Options**:

| Field | Local | Live |
|-------|-------|------|
| Server URL | `http://localhost:3000/api/extension/v1` | `https://skarion-talent-os.skarion-talentos.workers.dev/api/extension/v1` |
| API Key | Paste `tos_...` key | Paste `tos_...` key |
| Candidate ID | Your candidate UUID | Your candidate UUID |

Click **Test Connection** → should show green "Connected!"  
Click **Save Settings**

### 6.4 Testing Each Extension

| Extension | How to Test |
|-----------|-------------|
| Job Capture | Visit any job posting, click icon. Job appears in TalentOS `/jobs` with source `extension`. |
| QA | Visit any job posting, click icon. Readiness panel shows score, matched/missing/flagged. If all empty, candidate needs resume uploaded or verified_skills added. |
| Copilot | Create an application row: `status='assigned'`, `review_status='approved'`, `candidate_id` = your candidate, `job_id` = a job with an ATS apply URL. Navigate to the ATS page, click icon. Summary card shows → pick resume → fill → review → manually submit. |

---

## 7. Files Changed — Complete List

### TalentOS (`C:\Shohan\Skarion\TalentOS`)

| File | Status | Change |
|------|--------|--------|
| `src/middleware.ts` | **UPDATED** | Added CORS handling for `/api/extension/v1/*` paths |
| `src/lib/extensionAuth.ts` | **UPDATED** | Added `extension:resume:read` scope, `withExtensionCors()` helper, `getExtensionCorsHeaders()` |
| `src/app/api/admin/extension-keys/route.ts` | **UPDATED** | Added `extension:resume:read` to valid scopes |
| `src/app/admin/extension-keys/page.tsx` | **UPDATED** | Added "Resume Read" scope checkbox |
| `src/app/api/extension/v1/adapters/manifest/route.ts` | **UPDATED** | CORS wrap + greenhouse maturity → `verified` |
| `src/app/api/extension/v1/capture-job/route.ts` | **UPDATED** | CORS wrap |
| `src/app/api/extension/v1/evidence/route.ts` | **UPDATED** | CORS wrap |
| `src/app/api/extension/v1/queue/next/route.ts` | **UPDATED** | CORS wrap + fixed `c.location` → COALESCE(city, country, location_preference) |
| `src/app/api/extension/v1/readiness/preview/route.ts` | **UPDATED** | CORS wrap + fetches `resumes.parsed_json.skills`, extracts individual tokens, includes in readiness |
| `src/app/api/extension/v1/readiness/[applicationId]/route.ts` | **UPDATED** | Same resume skills extraction |
| `src/app/api/extension/v1/candidate/resumes/route.ts` | **NEW** | GET endpoint listing candidate resumes |
| `src/app/api/extension/v1/resume-download/route.ts` | **NEW** | GET proxy for resume file download |

### Extensions (`C:\Shohan\Skarion\TalentOS-Extensions\TalentOS-Extensions`)

| Extension | File | Status |
|-----------|------|--------|
| extension-job-capture | `manifest.json` | UPDATED (v0.3.0) |
| extension-job-capture | `background.js` | **REWRITTEN** |
| extension-job-capture | `content.js` | **REWRITTEN** |
| extension-job-capture | `options.js` | **REWRITTEN** |
| extension-job-capture | `options.html` | UPDATED |
| extension-qa | `manifest.json` | UPDATED (v0.3.0) |
| extension-qa | `background.js` | **REWRITTEN** |
| extension-qa | `content.js` | **REWRITTEN** |
| extension-qa | `options.js` | **REWRITTEN** |
| extension-qa | `options.html` | **REWRITTEN** |
| extension-copilot | `manifest.json` | UPDATED (v0.3.0) |
| extension-copilot | `background.js` | **REWRITTEN** |
| extension-copilot | `copilot.js` | **REWRITTEN** |
| extension-copilot | `options.js` | **REWRITTEN** |
| extension-copilot | `options.html` | **REWRITTEN** |

### Plan & Docs

| File | Status |
|------|--------|
| `.kilo/plans/1783861948027-talentos-extensions-integration-plan.md` | Implementation plan |
| `Extension_updated_handover.md` | This file |

---

## 8. Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Connection failed" on Test | Options page can't cross-origin fetch | Already fixed — test is routed through background.js. Reload extension. |
| "URL scheme localhost not supported" | Base URL saved without `http://` | Already fixed — `normalizeBaseUrl()` auto-prepends. Reload extension. |
| "Access-Control-Allow-Origin" CORS error | Next.js auto-handles OPTIONS before route wrapper | Already fixed — CORS is in `middleware.ts`. Restart dev server. |
| QA shows same empty results on every page | Candidate has no verified_skills, no evidence, no resume | Upload a resume in TalentOS (candidate page → Upload Resume). Ensure it's parsed. |
| Copilot "No approved applications" | No `applications` row for candidate with `status='assigned'` AND `review_status='approved'` | Create/approve an application in TalentOS for the candidate. |
| Copilot fills nothing on form | Adapter is `draft` or selectors don't match ATS site | Draft adapters now work with a warning. If form still empty, the ATS may have changed their HTML. |
| File upload blocked in copilot | Site uses custom uploader that doesn't allow programmatic `.files` assignment | Marked "blocked" in review panel. Upload manually. |

---

## 9. How to Update Extensions After Code Changes

Whenever extension files are changed:

1. Go to `chrome://extensions`
2. Find the extension card
3. Click the **refresh icon** (circular arrow)
4. Reload any open pages where the extension is active

For TalentOS server changes:

1. Stop the dev server (`Ctrl+C` in terminal)
2. Run `npm run dev` again
3. Wait for "Ready in Xms"

---

## 10. Next Steps / Future Work

- **PDF resume text extraction for readiness:** Currently only `parsed_json.skills` is used. The raw text of the resume could also be compared against the JD for deeper analysis.
- **Multi-resume comparison:** The copilot could let the user compare different resume versions against the same job.
- **ATS adapter auto-discovery:** The current embedded adapters cover 5 ATS platforms. A system to crowdsource or auto-detect selectors would expand coverage.
- **Evidence sync for QA notes:** QA evidence notes are stored locally only. Syncing them to TalentOS as `candidate_evidence` would close the loop.
- **Job Capture screenshot:** Currently sends `screenshotUrl: null`. Could capture a screenshot of the job page for reference.
