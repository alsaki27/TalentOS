# TalentOS Extension Integration Plan

> **Goal:** Make the three browser extensions (`extension-qa`, `extension-job-capture`, `extension-copilot`) work end-to-end with the TalentOS project using Extension API Keys. Jobs are captured into TalentOS, candidate readiness is checked against TalentOS resume/evidence, and the copilot fills ATS forms using a resume selected from TalentOS.
>
> **Live TalentOS URL:** `https://skarion-talent-os.skarion-talentos.workers.dev`  
> **Default testing URL:** `http://localhost:3000/api/extension/v1`  
> **Plan only — no source edits yet.**

---

## 1. Constraints

- **Minimize changes to TalentOS.** Only add the small API surfaces the extensions need (resume list, CORS, adapter manifest truth).
- **Keep extension architecture as-is.** They are bundled MV3 extensions with shared code duplicated in each `*.js`; plan edits the compiled JS files directly.
- **Default to localhost for testing, but accept any live URL** via the extension options page.
- **Do not auto-submit ATS forms.** Copilot fills for human review and manual submit.
- **Resume upload must use a resume explicitly selected from TalentOS** via a new extension-scoped API.

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Extension base URL default = `http://localhost:3000/api/extension/v1` | TalentOS dev runs on `:3000`; API version prefix is part of the base so endpoint paths can stay `/capture-job`, `/queue/next`, etc. |
| 2 | Add CORS handling for all `/api/extension/v1/*` routes in TalentOS | Chrome extensions fetch from `chrome-extension://` origin and send `Authorization`/`Idempotency-Key`/`X-TalentOS-Client` headers. |
| 3 | Add `GET /api/extension/v1/candidate/resumes` in TalentOS | Copilot needs a selectable list of resumes belonging to the candidate. Returns `id`, `fileName`, `fileUrl`, `isOriginalUpload`, `createdAt`. |
| 4 | Add `GET /api/extension/v1/resume-download?url=...` proxy in TalentOS | Avoids CORS/host-permission problems when the copilot fetches the selected resume file. Streams the file through the authenticated extension API. |
| 5 | New scope: `extension:resume:read` | Fine-grained access to candidate resume list + download. Added to `extensionAuth.ts`, admin API, and admin UI scope list. |
| 6 | Resume selection happens inside the copilot summary UI | After `/queue/next`, copilot fetches resume list and shows a dropdown. User picks one before clicking **Fill Application**. |
| 7 | Copilot file fill supports `<input type="file">` | Fetch selected resume through proxy, build `File` + `DataTransfer`, assign `input.files`, dispatch `change`. Mark status as `filled`, `uncertain`, or `blocked` in the review panel. |
| 8 | Allow draft adapters with a warning | The TalentOS manifest currently marks every adapter `draft`, which makes the copilot hard-block. Update manifest to match embedded adapter maturity and soften copilot to warn instead of block. |
| 9 | Route QA API calls through the QA background script | QA currently fetches directly from the injected content script, which fails on external sites due to CORS/CSP. Add a message handler and have `content.js` ask `background.js` to call `/readiness/preview`. |
| 10 | Make Candidate ID optional in `extension-job-capture` options | Job capture does not need a candidate; requiring one is confusing. QA and Copilot still require it. |

---

## 3. Data Flow

### 3.1 Job Capture

```
User clicks extension icon on job page
        │
        ▼
content.js extracts title, company, location, jdText, applyUrl,
          sourceSite, salary, atsDetected
        │
        ▼
chrome.runtime.sendMessage({ action: "captureJob", data })
        │
        ▼
background.js ──POST /api/extension/v1/capture-job──► TalentOS
                                                    creates row in jobs
                                                    source = 'extension'
        │
        ▼
badge OK / DUP / ERR, toast + preview panel
```

### 3.2 Resume QA

```
User clicks extension icon on job page
        │
        ▼
content.js extracts JD text
        │
        ▼
chrome.runtime.sendMessage({ action: "previewReadiness", jdText })
        │
        ▼
background.js ──POST /api/extension/v1/readiness/preview──► TalentOS
                                                          uses key-bound candidate's
                                                          verified_skills + candidate_evidence
        │
        ▼
background.js returns { score, threshold, matched, missing, flagged }
        │
        ▼
content.js renders readiness panel (matched / missing / flagged)
  └─ "+ evidence" notes stored locally in chrome.storage (no applicationId available)
```

### 3.3 Apply Copilot

```
User clicks extension icon on ATS application page
        │
        ▼
background.js checks candidateId from options
        │
        ▼
GET /api/extension/v1/queue/next?candidateId=... ──► TalentOS
  returns ticket { applicationId, jobTitle, company, applyUrl, profile }
        │
        ▼
GET /api/extension/v1/candidate/resumes ──► TalentOS
  returns candidate's resume list
        │
        ▼
background.js detects ATS from applyUrl hostname, fetches /adapters/manifest
injects copilot.js with { ticket, adapterName, resumes }
        │
        ▼
copilot.js shows summary card with resume dropdown
        │
        ▼
User selects resume, clicks "Fill Application"
        │
        ▼
copilot.js calls fillFields(adapter, profile, selectedResumeUrl)
  - text/select inputs: set value + dispatch events
  - file inputs: fetch resume via /resume-download proxy, build File/DataTransfer
installs submit evidence listener
        │
        ▼
User submits form → captureEvidence message → background
  captureVisibleTab + POST /api/extension/v1/evidence
```

---

## 4. TalentOS Changes (Minimal)

### 4.1 CORS for Extension Routes

Add a CORS helper/wrapper used by every `/api/extension/v1/*` route (or handle in `middleware.ts`):

- On `OPTIONS`: return `204` with headers.
- On all requests:
  - `Access-Control-Allow-Origin: <request Origin>` (echo, not `*`)
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key, X-TalentOS-Client`
  - `Access-Control-Allow-Credentials: true` (not strictly needed for Bearer, but safe)

**Files:**
- `src/lib/extensionAuth.ts` — add `withExtensionCors(handler)` helper.
- `src/app/api/extension/v1/*/route.ts` — wrap exports.

### 4.2 New Scope

- `extension:resume:read`

**Files:**
- `src/lib/extensionAuth.ts` — add to `EXTENSION_SCOPES`.
- `src/app/api/admin/extension-keys/route.ts` — add to `VALID_SCOPES`.
- `src/app/admin/extension-keys/page.tsx` — add to `ALL_SCOPES` UI list.

### 4.3 New Resume List Endpoint

`GET /api/extension/v1/candidate/resumes?candidateId=<id>`

Scope: `extension:resume:read`

Query candidate's `resumes` table:

```sql
SELECT id, file_url, is_original_upload, created_at
FROM resumes
WHERE candidate_id = $1
ORDER BY is_original_upload DESC, created_at DESC
```

Response:

```json
{
  "resumes": [
    {
      "id": "uuid",
      "fileName": "resume.pdf",
      "fileUrl": "https://...",
      "isOriginalUpload": true,
      "createdAt": "2026-07-15T..."
    }
  ]
}
```

Derive `fileName` from `file_url` last path segment; if missing, default to `resume.pdf`.

**File:** `src/app/api/extension/v1/candidate/resumes/route.ts`

### 4.4 New Resume Download Proxy

`GET /api/extension/v1/resume-download?url=<fileUrl>`

Scope: `extension:resume:read`

- Validate `url` belongs to allowed storage domains (Supabase public URL pattern; or allow any HTTPS and validate with a HEAD request).
- `fetch(url)` from the server.
- Stream response back with `Content-Type`, `Content-Disposition: attachment`, `Cache-Control: no-store`.
- On failure return `502` with JSON error.

**File:** `src/app/api/extension/v1/resume-download/route.ts`

### 4.5 Update Adapter Manifest

Change TalentOS manifest to match the actual embedded adapter maturity in `copilot.js`:

- `greenhouse`: `maturity: "verified"`
- `lever`, `ashby`: `maturity: "draft"`
- `workday`, `icims`: `maturity: "draft"`, `checksum: "stub"`

**File:** `src/app/api/extension/v1/adapters/manifest/route.ts`

---

## 5. Extension Changes

All three extensions are compiled bundles. Edits are made directly to the shipped `.js` files. Each file contains an embedded copy of the shared API client; the same string/path changes must be applied to every extension that uses the endpoint.

### 5.1 Shared Changes (apply to all three extensions)

In `options.js`, `background.js`, `content.js`/`copilot.js`:

1. **Default base URL:** change `http://localhost:4114` → `http://localhost:3000/api/extension/v1`.
2. **Options hint:** change placeholder/hint text to mention full API base, e.g.:
   - local: `http://localhost:3000/api/extension/v1`
   - live: `https://skarion-talent-os.skarion-talentos.workers.dev/api/extension/v1`
3. **Add resume endpoints to embedded API client:**
   - `getCandidateResumes(candidateId)` → `GET /candidate/resumes?candidateId=...`
   - `downloadResume(url)` → `GET /resume-download?url=...`
4. **No other endpoint paths change** because the base URL now includes `/api/extension/v1`.

### 5.2 `extension-job-capture`

**Files:** `manifest.json`, `background.js`, `content.js`, `options.js`, `options.html`

1. `options.js` / `options.html`: make Candidate ID optional for this extension.
   - Remove the `if (!candidateId)` error in `saveSettings`.
   - Keep the input but change hint to "Optional — only needed for Apply Copilot".
2. `background.js`: keep existing capture + evidence logic.
3. `content.js`: keep extraction logic.

### 5.3 `extension-qa`

**Files:** `manifest.json`, `background.js`, `content.js`, `options.js`, `options.html`

1. `background.js`: add a message listener for `previewReadiness`.
   ```js
   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
     if (message.action === "previewReadiness") {
       previewReadiness(message.data)
         .then(r => sendResponse({ success: true, result: r }))
         .catch(err => sendResponse({ success: false, error: err.message }));
       return true;
     }
   });
   ```
2. `content.js`: replace direct `previewReadiness({ jdText }).then(...)` with:
   ```js
   chrome.runtime.sendMessage(
     { action: "previewReadiness", data: { jdText } },
     (response) => { ... }
   );
   ```
3. Keep local evidence-note storage as-is.

### 5.4 `extension-copilot`

**Files:** `manifest.json`, `background.js`, `copilot.js`, `options.js`, `options.html`

1. `background.js`:
   - After fetching `/queue/next`, call `getCandidateResumes(candidateId)`.
   - Pass `{ ticket, adapterName, resumes }` to `copilot.js`.
   - Do **not** hard-block on `adapterEntry.maturity === "draft"`; instead pass `adapterMaturity` to `copilot.js` and let it warn.
   - Add message listener for `downloadResume` so `copilot.js` can ask background to fetch the file through the authenticated proxy.
2. `copilot.js`:
   - Accept `window.__TALENTOS_COPILOT_DATA__` shape `{ ticket, adapterName, resumes, adapterMaturity }`.
   - In `showSummary`, render a resume dropdown populated from `resumes`. Default to the most recent `isOriginalUpload === true` resume.
   - On **Fill Application**, pass the selected `resumeUrl` into `fillFields`.
   - Extend `fillFields` / `applyFill` to handle `resumeUpload`:
     - If file input exists and a resume is selected, send `downloadResume` message to background.
     - Convert the `ArrayBuffer`/`Blob` response into a `File`.
     - Build `DataTransfer`, assign `input.files = dataTransfer.files`.
     - Dispatch `change` event.
     - Mark status `filled` if successful; `blocked` if the browser/site prevents it.
   - Show a warning banner in the review panel if `adapterMaturity === "draft"` or if any file upload was `blocked`.
3. `options.js` / `options.html`:
   - Keep Candidate ID required.
   - Update base-URL hint to include live URL example.

---

## 6. Files to Modify

### TalentOS

| File | Change |
|------|--------|
| `src/lib/extensionAuth.ts` | Add `extension:resume:read` scope; add CORS wrapper helper. |
| `src/app/api/admin/extension-keys/route.ts` | Add `extension:resume:read` to `VALID_SCOPES`. |
| `src/app/admin/extension-keys/page.tsx` | Add resume-read scope checkbox. |
| `src/app/api/extension/v1/*/route.ts` | Wrap route handlers with CORS helper. |
| `src/app/api/extension/v1/candidate/resumes/route.ts` | **New** — list candidate resumes. |
| `src/app/api/extension/v1/resume-download/route.ts` | **New** — proxy resume file download. |
| `src/app/api/extension/v1/adapters/manifest/route.ts` | Update adapter maturity to match embedded adapters. |

### Extensions

| Extension | File | Change |
|-----------|------|--------|
| all | `options.js`, `background.js`, `content.js`/`copilot.js` | Default base URL, hints, add resume client functions. |
| `extension-job-capture` | `options.js`, `options.html` | Candidate ID optional. |
| `extension-qa` | `background.js` | Add `previewReadiness` message handler. |
| `extension-qa` | `content.js` | Route readiness call through background. |
| `extension-copilot` | `background.js` | Fetch resumes, pass to copilot, allow draft adapters, proxy file download. |
| `extension-copilot` | `copilot.js` | Resume picker, file upload fill, draft warning. |

---

## 7. Validation Plan

1. **TalentOS API keys**
   - Log in as admin → `/admin/extension-keys`.
   - Create three keys with these scopes:
     - Job Capture: `extension:job:capture`, `extension:adapters:read`
     - QA: `extension:readiness:read`, `extension:adapters:read`
     - Copilot: `extension:queue:read`, `extension:readiness:read`, `extension:evidence:write`, `extension:adapters:read`, `extension:resume:read`
   - Bind each to a real candidate.

2. **Local testing**
   - Run TalentOS dev on `http://localhost:3000`.
   - Load each extension unpacked in Chrome.
   - Set base URL to `http://localhost:3000/api/extension/v1`, paste key, set candidate ID.
   - **Job Capture:** visit a job posting, click icon, verify job appears in `/jobs` with source `extension`.
   - **QA:** visit a job posting, click icon, verify readiness panel loads with score/matched/missing/flagged.
   - **Copilot:** create an `applications` row with `status = 'assigned'`, `review_status = 'approved'` for the candidate and a job with an ATS apply URL (e.g. greenhouse.io). Click icon, select resume, verify fields are filled, submit form, verify `application_evidence` row is created.

3. **Live testing**
   - Set base URL to `https://skarion-talent-os.skarion-talentos.workers.dev/api/extension/v1`.
   - Repeat smoke tests for each extension.
   - Verify no CORS errors in extension background console.

4. **Edge cases**
   - Candidate with no resumes → copilot shows empty picker and disables fill until user uploads manually.
   - Candidate with multiple resumes → picker defaults to most recent original upload.
   - ATS site with `Content-Security-Policy` blocking inline script injection → copilot shows error toast.
   - File input hidden behind custom widget → mark `blocked` in review panel; user uploads manually.
   - Duplicate job capture → badge shows `DUP` and TalentOS returns existing `jobId`.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Bundled extension JS is hard to edit safely | Make small, scoped string replacements; test each extension immediately after edit. |
| File upload on ATS sites is blocked by security policies | Use TalentOS proxy for fetch; still warn user and never auto-submit. |
| CORS on live Workers deployment | Add explicit CORS handling in TalentOS for `/api/extension/v1/*`. |
| Resume `file_url` is not publicly fetchable | Proxy through `/api/extension/v1/resume-download` using server-side fetch. |
| Draft adapter maturity mismatch | Update TalentOS manifest + soften copilot to warn instead of block. |
| QA content-script CORS failures | Route QA calls through background script. |

---

## 9. Out of Scope (for this plan)

- Rewriting extensions into a buildable monorepo.
- Adding new ATS adapters beyond the five already embedded.
- Auto-submitting application forms.
- Storing QA evidence notes in TalentOS (they stay local).
- Screenshot capture during job capture.

---

## 10. Implementation Order

1. TalentOS CORS helper + apply to existing extension routes.
2. TalentOS new scope + admin UI update.
3. TalentOS new endpoints (`/candidate/resumes`, `/resume-download`).
4. TalentOS update adapter manifest maturity.
5. Update all three extension bundles with new default base URL, hints, and resume client functions.
6. Update `extension-job-capture` options to make candidate ID optional.
7. Update `extension-qa` to route readiness calls through background.
8. Update `extension-copilot` background + copilot.js for resume selection, file upload, and draft warning.
9. Validate locally, then validate live.
