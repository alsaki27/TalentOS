# Markitdown Integration Plan — TalentOS

## Current State & Problems

### Upload Flow (Broken)
- `candidates/[id]/resume/route.ts` uploads primary resume → SharePoint/R2
- `candidates/[id]/resumes/route.ts` uploads variants → optionally parses with `pdf-parse` + AI
- `pdf-parse` is Node.js-only, breaks on Cloudflare Workers. The current `extractText()` uses `Buffer.from()` and `pdf-parse` which is unreliable.
- The upload itself may be failing because SharePoint errors are swallowed and not shown to the user.

### Parsing Flow (Token-heavy)
1. `extractText(buffer, mimeType)` → uses `pdf-parse` or `mammoth` → raw unstructured text
2. `parseResumeFields(rawText)` → sends raw text to AI API → structured JSON
3. **Problem**: Raw text is noisy, loses formatting, uses many AI tokens to structure it.

### What the User Wants
1. **Fix the upload** — make it actually work
2. **Use markitdown** (Microsoft's Python library) for PDF→Markdown conversion — better quality, preserves structure, cheaper for AI
3. **A button** on the candidate page: "Parse Resume with markitdown → Create Base Resume"
4. **Apply markitdown to all PDF flows** — evidence generation, resume variants, etc.

---

## Architecture Decision

### Markitdown is Python
- The TalentOS app is TypeScript/Next.js deployed to **Cloudflare Workers** (edge runtime, no Python)
- **Solution**: Create a separate Python microservice that runs markitdown. The Next.js app calls it via HTTP.
- **Local dev**: User runs `python services/markitdown/main.py` → available at `http://localhost:8000`
- **Production**: User deploys this service separately (Docker, VM, or serverless)

### Why this is the right approach
- markitdown requires Python (no JS equivalent with the same quality)
- Cloudflare Workers can't run Python
- A separate service is standard microservices architecture
- The service is tiny (~50 lines) and stateless

---

## Implementation Plan

### Phase 1: Python Markitdown Service
**Files to create:**
- `services/markitdown/main.py` — FastAPI app with `/parse` endpoint
- `services/markitdown/requirements.txt` — dependencies
- `services/markitdown/README.md` — setup instructions

**Endpoint:** `POST /parse` — accepts multipart PDF file, returns `{ markdown: string }`

### Phase 2: Next.js Markitdown Client
**Files to create:**
- `src/lib/markitdown.ts` — HTTP client that calls the markitdown service
- `src/app/api/markitdown/parse/route.ts` — Next.js API route that forwards PDF → markitdown service

### Phase 3: Update Resume Parsing
**File to modify:** `src/lib/resumeParsing.ts`
- Add `extractMarkdownWithMarkitdown(buffer, mimeType)` — tries markitdown service first, falls back to `pdf-parse` locally
- Add `parseResumeFromMarkdown(markdown: string)` — sends markdown (instead of raw text) to AI API → structured JSON
- Markdown is much cleaner for AI parsing than raw extracted text → **saves tokens**

### Phase 4: Fix Upload + Add Diagnostic
**Files to modify:**
- `src/app/api/candidates/[id]/resume/route.ts` — add better error logging, ensure upload succeeds even if parsing fails
- `src/app/api/candidates/[id]/resumes/route.ts` — use new markitdown-aware parsing
- `src/app/api/diagnostics/storage/route.ts` — NEW: test endpoint to verify storage connectivity

### Phase 5: "Parse & Create Base Resume" Button
**Files to modify:**
- `src/app/candidates/[id]/page.tsx` — add button: "Parse with markitdown & Create Base Resume"
- Flow: Upload PDF → markitdown → AI extraction → `POST /api/base-resumes` with `startingSource: "uploaded_resume"` → redirect to base resume studio

### Phase 6: Apply to All PDF Flows
- Evidence generation from resume — use markitdown output
- Resume variant upload — use markitdown output
- Any other PDF processing in the app

---

## Files to Create (7 new)
1. `services/markitdown/main.py`
2. `services/markitdown/requirements.txt`
3. `services/markitdown/README.md`
4. `src/lib/markitdown.ts`
5. `src/app/api/markitdown/parse/route.ts`
6. `src/app/api/diagnostics/storage/route.ts`
7. `src/app/api/candidates/[id]/parse-markitdown/route.ts` — dedicated parse endpoint

## Files to Modify (5 existing)
1. `src/lib/resumeParsing.ts` — add markitdown path, markdown-aware AI parsing
2. `src/app/api/candidates/[id]/resume/route.ts` — better errors, non-blocking parse
3. `src/app/api/candidates/[id]/resumes/route.ts` — use markitdown parsing
4. `src/app/candidates/[id]/page.tsx` — add "Parse & Create Base Resume" button
5. `.env.example` — add MARKITDOWN_SERVICE_URL

---

## How the User Uses It

### Local Development
```bash
# 1. Install Python dependencies
pip install markitdown fastapi uvicorn python-multipart

# 2. Start the markitdown service
python services/markitdown/main.py
# → Service running on http://localhost:8000

# 3. In another terminal, start the Next.js app
npm run dev
# → Upload a resume, click "Parse with markitdown & Create Base Resume"
```

### Production
- Deploy the Python service to a container/VM (e.g., Docker on AWS/Azure)
- Set `MARKITDOWN_SERVICE_URL=https://your-service.com` in env vars
- The Next.js app (on Cloudflare Workers) calls the deployed service

---

## Token Savings
- **Before**: PDF → raw text (noisy, jumbled) → AI structures it (~3000-5000 tokens)
- **After**: PDF → markdown (structured, clean) → AI structures it (~1500-2500 tokens)
- **Savings**: ~40-50% fewer tokens per resume parse
