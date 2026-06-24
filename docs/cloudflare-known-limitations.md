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

**Workarounds:**
1. **Use an external scheduler** — Cron-job.org, EasyCron, or a simple GitHub Actions workflow that calls your API endpoints
2. **Use Cloudflare Workers paid plan** — $5/month adds Cron Triggers
3. **Use a separate Vercel project** for cron endpoints only

**Recommended:** Option 1 (external scheduler). Cron-job.org is free and reliable.

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

## External Service Architecture (Recommended for Full Production)

For a production setup that handles all features:

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                    │
│  (Main app: Next.js, all routes, all DB queries)       │
│  - Neon DB for business data                             │
│  - Supabase Auth for authentication                      │
│  - Supabase Storage for file uploads                     │
│  - R2 for CDN assets (optional)                        │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ PDF/DOCX generation request
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Vercel / Railway (Node.js)                 │
│  (Microservice: only PDF/DOCX export)                  │
│  - @react-pdf/renderer for PDFs                         │
│  - docx for DOCX files                                  │
│  - Called via HTTP API from Cloudflare Worker           │
└─────────────────────────────────────────────────────────┘
                   │
                   │ Cron trigger
                   ▼
┌─────────────────────────────────────────────────────────┐
│                  Cron-job.org (Free)                      │
│  - Calls /api/cron/digest daily                         │
│  - Calls /api/cron/backup weekly                        │
└─────────────────────────────────────────────────────────┘
```

This architecture keeps the main app on the free Cloudflare Workers tier while externalizing only the Node.js-only features to cheap/paid services.

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
