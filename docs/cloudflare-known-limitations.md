# TalentOS Cloudflare Workers Deployment: Known Limitations

## Status: Cloudflare Build Succeeds ✅

The app compiles successfully for Cloudflare Workers with `DB_PROVIDER=neon`.

## Runtime Limitations

### 1. PDF Export (`/api/export/pdf`) — ❌ Will Fail on Cloudflare Workers

**Package:** `@react-pdf/renderer` v4.5.1
**Issue:** Requires Node.js APIs (Canvas, font rendering, file system) not available on Cloudflare Workers
**Error at runtime:** Will throw `ReferenceError` or `TypeError` when trying to render PDF

**Workarounds:**
1. **Externalize to a Node.js service** — Deploy a tiny Express server on Vercel/Railway that only handles PDF generation, call it via HTTP from the Cloudflare Worker
2. **Use a WASM-based PDF renderer** — Replace `@react-pdf/renderer` with `pdfmake` + browser-based rendering, or use `jsPDF` (client-side only)
3. **Pre-generate PDFs** — Generate PDFs on-demand via a separate API route running on Node.js
4. **Use Gotenberg** — A Docker-based PDF generation service (requires external hosting)

**Recommended:** Option 1 (externalize). Create a `/api/pdf-worker` on Vercel that uses `@react-pdf/renderer` and call it from the Cloudflare Worker.

### 2. DOCX Export (`/api/export/docx`) — ❌ Will Fail on Cloudflare Workers

**Package:** `docx` (npm package)
**Issue:** Requires Node.js `Buffer` and stream APIs
**Error at runtime:** Will throw `ReferenceError` when trying to create DOCX buffer

**Workarounds:**
1. **Externalize to Node.js service** — Same as PDF
2. **Use client-side generation** — Use `docx` in the browser and let the user download directly
3. **Use a WASM alternative** — There are limited WASM DOCX generators; most require Node.js

**Recommended:** Option 2 (client-side). Move DOCX generation to the browser. The `docx` package can work in the browser with Webpack/Vite bundling.

### 3. Buffer Usage — ⚠️ Partially Supported

The `nodejs_compat` compatibility flag enables some Buffer APIs on Cloudflare Workers. However:
- `Buffer.from()` — ✅ Supported
- `Buffer.alloc()` — ✅ Supported
- `Buffer.isBuffer()` — ✅ Supported

Our `secretCrypto.ts` uses Web Crypto API (`crypto.subtle`), which is fully supported. No issues here.

### 4. Cron Jobs — ❌ Not Supported on Free Tier

The app uses `vercel.json` for cron jobs. Cloudflare Workers free tier does NOT support Cron Triggers (paid only).

**Affected endpoints** (defined in `vercel.json`, need external scheduler):
| Path | Schedule | Purpose |
|------|----------|---------|
| `GET /api/cron/digest` | `0 7 * * *` | Daily AI digest — new jobs, overdue tickets, pipeline summary |
| `GET /api/cron/import-sources` | `0 6 * * *` | Run saved import sources |
| `GET /api/cron/backup` | `0 5 * * *` | Daily DB backup |
| `GET /api/cron/categorize-jobs` | `0 8 * * *` | AI job categorization |
| `GET /api/cron/ai-usage-rollup` | `0 4 * * *` | Aggregate AI usage events into daily rollup |

All endpoints require `Authorization: Bearer {CRON_SECRET}` header.

**Workarounds:**
1. **Use an external scheduler** — Cron-job.org, EasyCron, or a simple GitHub Actions workflow that calls your API endpoints. Configure each endpoint with its schedule and the CRON_SECRET bearer token.
2. **Use Cloudflare Workers paid plan** — $5/month adds Cron Triggers. Add `[triggers]` with `crons = [...]` to `wrangler.toml` and route each pattern to the matching endpoint.
3. **Use a separate Vercel project** for cron endpoints only

**Recommended:** Option 1 (external scheduler). Cron-job.org is free and reliable.
   - Create a monitor for each endpoint URL
   - Set the schedule per the table above
   - Add `Authorization: Bearer {CRON_SECRET}` header
   - Request method: GET

**Manual fallback:** The `/ops` page has a "Generate now" button for the digest. For import sources and job categorization, there are also manual triggers on the ops page.

### 5. File System Access — ❌ Not Supported

Cloudflare Workers do not have a file system. Any code that writes to disk will fail.

**In our app:**
- PDF/DOCX export writes to temporary buffers (handled by `Buffer`, which works)
- No other file system access

### 6. In-Memory Cache — ⚠️ Ephemeral

Cloudflare Workers cache is ephemeral (per-request). Any in-memory state is lost between requests.

**In our app:**
- `supabaseRLS.ts` uses lazy initialization — works fine because it's re-created per request
- No server-side sessions (uses JWT)

### 7. WebSocket / Server-Sent Events — ⚠️ Limited

Cloudflare Workers support WebSockets, but the free tier has limits.

**In our app:**
- No WebSocket usage currently
- Supabase Realtime is not used (we removed it for Neon compatibility)

### 8. KV Storage — ✅ Available on Free Tier

Cloudflare KV is available on the free tier with limits:
- 1,000 reads/day
- 1,000 writes/day
- 1 GB storage

**Not currently used** but could be used for caching in the future.

## Free Tier Limits Summary

| Resource | Free Tier | Our Usage |
|----------|-----------|-----------|
| Requests/day | 100,000 | Unknown (depends on usage) |
| CPU time | 10 ms/request | Should be fine for DB queries |
| Memory | 128 MB | Fine (1.5MB bundle) |
| KV reads/day | 1,000 | Not used |
| KV writes/day | 1,000 | Not used |
| KV storage | 1 GB | Not used |
| Cron Triggers | ❌ Not available | Noted as limitation |
| Durable Objects | ❌ Not available | Not needed |
| R2 | ✅ Available (10GB free) | Could be used for storage |

## Deployment Checklist

Before deploying to Cloudflare:

- [ ] Set `DATABASE_URL` secret (Neon pooled connection)
- [ ] Set `DB_PROVIDER=neon` secret
- [ ] Set all other required secrets (Supabase auth, AI keys, etc.)
- [ ] Disable or externalize PDF/DOCX export routes
- [ ] Set up external cron scheduler (cron-job.org)
- [ ] Test with `wrangler dev` locally
- [ ] Deploy with `npm run cf:deploy`

## Rollback Plan

If the Cloudflare deployment has issues:

1. **Instant rollback:** Set `DB_PROVIDER=supabase` and the app reverts to Supabase DB
2. **Code rollback:** The Supabase code is still in the `else` branch of every `isNeon()` switch
3. **No data loss:** Supabase database remains unchanged

---

## RBAC: Manager Role

The TalentOS role-based access control system includes a `manager` role between `admin` and `application_engineer`.

### Role definition

| Role | Description |
|------|-------------|
| `admin` | Full access: all pages, team management, system config, AI key management, backup/restore |
| `manager` | Read access to all pages; can create/edit candidates, jobs, applications, resumes, follow-ups; **cannot** access Team page or modify system config |
| `application_engineer` | Application queue, follow-ups, candidates (read), applications (assigned only) |

### Implementation

- Defined in `profiles` table: `role IN ('admin', 'manager', 'application_engineer', 'recruiter')` (`sql/01_schema.sql:90`)
- Check constraint on `profiles.role` (`sql/01_schema.sql:89-90`)
- Enforced in app-layer auth (`src/lib/auth.ts`):
  - `MASTER_DATA_MANAGER_ROLES = ["admin", "manager"]` — can create/edit master data
  - `APPLICATION_WORKER_ROLES = ["admin", "manager", "application_engineer"]` — can work on applications
  - `ASSIGNMENT_MANAGER_ROLES = ["admin", "manager", "application_engineer"]` — can manage assignments
  - `DESTRUCTIVE_MANAGER_ROLES = ["admin", "manager"]` — can delete candidates/jobs/applications
- Team page (`/team`) restricted to `admin` only via `canAccessPath()` (`src/lib/auth.ts:71-73`)
- Manager cannot access `/team`, `/api/users/*`, or modify AI keys/system config

### Current state

- **No production account currently holds the `manager` role.** The role exists in the schema and code but has not been assigned to any user.
- To activate: open `/team` as admin, assign `manager` role to the target account.
- **This should be done after validating the manager dashboard works** — verify the manager can access all non-admin pages, cannot access `/team`, and has correct data scope.
- Do not modify any user's role in the database directly; use the `/team` UI.

### Manager permissions summary

| Page/Feature | Admin | Manager | Application Engineer |
|---|---|---|---|
| `/candidates` | Full CRUD | Full CRUD | Read only |
| `/jobs` | Full CRUD | Full CRUD | Hidden |
| `/companies` | Full access | Full access | Hidden |
| `/application-queue` | Full access | Full access | Assigned only |
| `/follow-ups` | Full access | Full access | Assigned only |
| `/review` | Full access | Full access | Read only |
| `/interviews` | Full access | Full access | Read only |
| `/analytics` | Full access | Full access | No access |
| `/team` | Full access | No access | No access |
| `/admin/ai` | Full access | No access | No access |
| `/ops` | Full access | No access | No access |
| `/audit` | Full access | No access | No access |
| `/chat` | Full access | Full access | Full access |

## External Service Architecture (Recommended for Full Production)

### Markitdown PDF Parsing Service

The "Parse with markitdown & Create Base Resume" button relies on an external **Markitdown** microservice for high-accuracy PDF-to-markdown conversion. Without it, parsing falls back to basic AI text extraction (less accurate).

**What is Markitdown:**
- Microsoft's [`markitdown`](https://github.com/microsoft/markitdown) Python library
- Converts PDFs (and other formats) to clean Markdown text
- Must be deployed as a separate HTTP service (e.g., FastAPI server)

**Deployment steps:**
1. Clone `https://github.com/microsoft/markitdown`
2. Deploy as a simple FastAPI server on Vercel, Railway, or any Node-capable host:
   ```python
   # server.py
   from fastapi import FastAPI, UploadFile, File
   from markitdown import MarkItDown
   
   app = FastAPI()
   md = MarkItDown()
   
   @app.post("/parse")
   async def parse(file: UploadFile = File(...)):
       result = md.convert(file.file)
       return {"success": True, "markdown": result.text_content}
   ```
3. Set `MARKITDOWN_SERVICE_URL` env var in TalentOS to point to the deployed service URL
4. Restart TalentOS — the button will activate and show "Parse with markitdown & Create Base Resume"

**Without the service:** The button shows "Parse with AI & Create Base Resume" and uses the AI fallback parser — less accurate but functional.

---

## Mitigation: Disabling PDF/DOCX Export Temporarily

If you want to deploy to Cloudflare now and fix PDF/DOCX later, add this guard to both routes:

```typescript
// src/app/api/export/pdf/route.ts
// src/app/api/export/docx/route.ts

export async function POST(req: NextRequest) {
  // Temporary guard for Cloudflare Workers
  if (typeof (globalThis as any).WebSocketPair === 'undefined' && !process.env.ENABLE_PDF_EXPORT) {
    return NextResponse.json(
      { error: "PDF export is temporarily unavailable. Please use the Supabase deployment for PDF/DOCX export." },
      { status: 503 }
    );
  }
  // ... rest of the route
}
```

Or better, add a feature flag:

```typescript
const PDF_EXPORT_ENABLED = process.env.ENABLE_PDF_EXPORT === 'true';

export async function POST(req: NextRequest) {
  if (!PDF_EXPORT_ENABLED) {
    return NextResponse.json({ error: "PDF export disabled on this deployment" }, { status: 503 });
  }
  // ...
}
```
