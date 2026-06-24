# Neon + Cloudflare Migration Audit — TalentOS/Skarion Tracker

**Audit date:** 2026-07-07
**Auditor:** AI Orchestrator (automated + manual review)
**Scope:** Full codebase audit for Supabase dependencies, Node-only runtime APIs, and Cloudflare Workers compatibility.

---

## Executive Summary

The TalentOS app is a Next.js 14 application currently running on Vercel + Supabase. The goal is to migrate to Neon Postgres (database) + Cloudflare Workers/Pages (runtime) using OpenNext.

**Migration feasibility:** Partial. The app can run on Cloudflare with Neon as the database, but **Supabase Auth must remain temporarily** as the authentication provider. Several Node-only features (PDF/DOCX export, `crypto` module, `Buffer`) require adapter layers or externalization.

**Recommended strategy:** **Hybrid Option A** — Neon for app data, Supabase Auth temporarily for login/session, with a phased migration path to full auth independence.

---

## 1. Supabase Dependency Audit

### 1.1 Core Client Setup

| File | Import | Key Used | Notes |
|------|--------|----------|-------|
| `src/lib/supabase.ts` | `@supabase/supabase-js` | `SUPABASE_SERVICE_ROLE_KEY` | **Lazy-initialized proxy.** Good for migration — can swap implementation. |
| `src/lib/supabaseRLS.ts` | `@supabase/supabase-js` | `SUPABASE_ANON_KEY` | **Unused dead code.** Created for RLS but never imported. |
| `src/lib/auth.ts` | `@supabase/supabase-js` (type only) + `@/lib/supabase` | Service role (via proxy) | Session validation + profile lookup. |
| `src/app/api/health/route.ts` | `@supabase/supabase-js` | Checks env presence | Health check. |
| `src/app/api/auth/login/route.ts` | `@supabase/supabase-js` | Anon key | Login/signup. |
| `scripts/setup-check.mjs` | `@supabase/supabase-js` | Service role | Build-time script. |
| `scripts/seed-admin.mjs` | `@supabase/supabase-js` | Service role | Build-time script. |

**Critical finding:** The service role key is the default client. ~120 files import `@/lib/supabase` and get a service-role-backed client. This is intentional for the internal tool architecture but is a migration concern because the Supabase client will be replaced.

### 1.2 Supabase Auth Usage (DEEP EMBEDDED — BLOCKER)

| File | Auth API | Purpose | Migration Impact |
|------|----------|---------|------------------|
| `src/lib/auth.ts:38` | `supabase.auth.getUser(token)` | Session validation in `getCurrentUserContext()` | **Must keep Supabase Auth temporarily.** Replace with JWT validation or new auth later. |
| `src/app/api/auth/login/route.ts` | `supabase.auth.signInWithPassword` + `supabase.auth.signUp` | Login/signup API | **Must keep Supabase Auth temporarily.** |
| `src/app/api/users/route.ts:46` | `supabase.auth.admin.createUser({...})` | Admin user creation | **Must keep Supabase Auth temporarily.** |
| `src/app/api/auth/password/route.ts:17` | `supabase.auth.admin.updateUserById(...)` | Admin password reset | **Must keep Supabase Auth temporarily.** |
| `scripts/seed-admin.mjs:37` | `client.auth.admin.listUsers({page, perPage})` | Admin seeding script | **Build-time only.** |

**Auth strategy decision:** Option A (Hybrid). Keep Supabase Auth for login/session. Add `auth_user_id` to `profiles` table for linking. Server routes validate Supabase JWT, then query Neon for app data.

### 1.3 Supabase Storage Usage

| File | Bucket | Operation | Notes |
|------|--------|-----------|-------|
| `src/lib/storage.ts` | `resumes` | `remove()` | Can migrate to R2/Cloudflare Storage later. |
| `src/lib/resumeStorage.ts` | `resumes` | `upload()` + `getPublicUrl()` | Can migrate to R2/Cloudflare Storage later. |
| `src/lib/backup.ts` | `resumes` | `upload()` to `backups/` | Can migrate to R2/Cloudflare Storage later. |
| `src/app/api/chat/attachments/route.ts` | `resumes` | `upload()` | Can migrate to R2/Cloudflare Storage later. |
| `src/app/api/applications/[id]/proof/route.ts` | `resumes` | `upload()` | Can migrate to R2/Cloudflare Storage later. |
| `src/app/api/candidates/[id]/photo/route.ts` | `resumes` | `upload()` | Can migrate to R2/Cloudflare Storage later. |
| `src/app/api/ops/backups/route.ts` | `resumes` | `list()` | Can migrate to R2/Cloudflare Storage later. |

**Storage strategy decision:** Keep Supabase Storage temporarily. Create a pluggable storage interface (`src/lib/resumeStorage.ts` already has one). Add R2 adapter in a future sprint.

### 1.4 `auth.users` References (SQL Schema)

| File | Reference | Impact |
|------|-----------|--------|
| `sql/01_schema.sql:86` | `profiles.user_id` FK → `auth.users(id)` | Must keep if Supabase Auth stays. |
| `supabase/migrations/20260617090000_auth_profiles_roles.sql:5` | `profiles.user_id` FK → `auth.users(id)` | Must keep if Supabase Auth stays. |
| `supabase/migrations/20260617090000_auth_profiles_roles.sql:40-42` | Trigger: `after insert on auth.users` | Must keep if Supabase Auth stays. |

**Schema strategy:** If Supabase Auth is kept, these references remain. If Supabase Auth is removed, replace `auth.users` with a local `users` table or use Clerk/Auth.js.

### 1.5 RLS Policies

| File | Policy | Status |
|------|--------|--------|
| `sql/02_rls_policies.sql` | `service_role_bypass` on 8 tables | Irrelevant for Neon — Neon has no RLS. App-layer auth is already enforced. |

**RLS strategy:** Not applicable for Neon. The app already enforces auth at the Next.js layer (`requireCurrentUser`).

### 1.6 `supabase.rpc` Usage

| File | Function | Notes |
|------|----------|-------|
| `src/app/api/analytics/funnel/route.ts:18` | `get_funnel_counts` | Must be reimplemented as a raw SQL query or Neon function. |

### 1.7 Classification of Supabase Usage

| Category | Count | Migration Action |
|----------|-------|------------------|
| `DATABASE_ONLY` (direct `supabase.from`) | ~120 files | Replace with Neon adapter. Repositories first. |
| `AUTH_REQUIRED` | 4 files | Keep Supabase Auth temporarily. |
| `STORAGE_REQUIRED` | 9 files | Keep Supabase Storage temporarily. Add R2 adapter later. |
| `SERVICE_ROLE_REQUIRED` | 6 files | Service role is only used for the Supabase client itself. Replace with Neon connection. |
| `CAN_REPLACE_NOW` | Repositories (Chunks 5-10) | Replace with Neon adapter. |
| `MUST_KEEP_TEMPORARILY` | Auth, Storage | Keep Supabase for auth and storage until full migration. |

---

## 2. Node-Only Runtime API Audit (Cloudflare Compatibility)

### 2.1 `crypto` module (Node.js) — CRITICAL

| File | APIs Used | Fix |
|------|-----------|-----|
| `src/server/security/secretCrypto.ts` | `crypto.createCipheriv`, `crypto.createDecipheriv`, `crypto.createHash`, `crypto.randomBytes`, `Buffer` | Replace with Web Crypto API (`crypto.subtle`). |
| `src/lib/webhookEngine.ts` | `crypto.createHmac` | Replace with `crypto.subtle.sign("HMAC", ...)`. |
| `src/lib/publicApiAuth.ts` | `crypto.randomBytes`, `crypto.createHash` | Replace with `crypto.getRandomValues()` + `crypto.subtle.digest()`. |
| `src/lib/integrations/googleGmail.ts` | `crypto.randomBytes`, `Buffer.from` | Replace with `crypto.getRandomValues()` + `Uint8Array`. |

### 2.2 `docx` package — CRITICAL

| File | Usage | Fix |
|------|-------|-----|
| `src/lib/falood/docxExport.ts` | `import { Document, Packer } from "docx"` | Node-only. Requires external service or pure JS XML writer. |
| `src/server/services/resumeExportService.ts` | Transitive import | Will break. |
| `src/app/api/export/docx/route.ts` | Transitive import | Will break. |

### 2.3 `@react-pdf/renderer` — CRITICAL

| File | Usage | Fix |
|------|-------|-----|
| `src/lib/falood/skarionPdfDocument.tsx` | React PDF components | Node-only. Requires external service or `pdf-lib`. |
| `src/lib/falood/pdfExport.ts` | `renderToBuffer()` | Will break. |
| `src/server/services/resumeExportService.ts` | Transitive import | Will break. |
| `src/app/api/export/pdf/route.ts` | Transitive import | Will break. |

### 2.4 `pdf-parse` + `mammoth` — CRITICAL

| File | Usage | Fix |
|------|-------|-----|
| `src/lib/resumeParsing.ts` | `pdf-parse`, `mammoth` | Node-only. Replace with WASM or external service. |
| `src/lib/falood/pdfExport.ts` | `pdf-parse` (page count) | Will break. |

### 2.5 `Buffer` usage (global, no import) — MODERATE

| File | Usage | Fix |
|------|-------|-----|
| `src/app/api/applications/[id]/proof/route.ts` | `Buffer.from(await file.arrayBuffer())` | Replace with `new Uint8Array(arrayBuffer)`. |
| `src/app/api/chat/attachments/route.ts` | `Buffer.from(await file.arrayBuffer())` | Replace with `new Uint8Array(arrayBuffer)`. |
| `src/app/api/candidates/[id]/photo/route.ts` | `Buffer.from(await file.arrayBuffer())` | Replace with `new Uint8Array(arrayBuffer)`. |
| `src/app/api/candidates/[id]/resumes/route.ts` | `Buffer.from(await file.arrayBuffer())` | Replace with `new Uint8Array(arrayBuffer)`. |
| `src/app/api/candidates/[id]/resume/route.ts` | `Buffer.from(await file.arrayBuffer())` | Replace with `new Uint8Array(arrayBuffer)`. |
| `src/lib/integrations/sharepoint.ts` | `Buffer.from(...)` | Replace with `Uint8Array` + TextEncoder. |
| `src/lib/integrations/googleGmail.ts` | `Buffer.from(payload, "base64url")` | Replace with pure JS base64 decode. |
| `src/lib/resumeStorage.ts` | `Buffer` type parameter | Replace with `Uint8Array` type. |
| `src/server/services/resumeExportService.ts` | `Buffer.from(string, "utf-8")` | Replace with `new TextEncoder().encode(string)`. |
| `src/lib/falood/pdfExport.ts` | `Buffer` return type | Replace with `Uint8Array`. |
| `src/lib/falood/docxExport.ts` | `Buffer` from `Packer.toBuffer()` | Node-only — externalize. |

### 2.6 `process.env` at import time — MODERATE

| File | Usage | Fix |
|------|-------|-----|
| `src/lib/supabaseRLS.ts` | `createClient(process.env.SUPABASE_URL!, ...)` at module level | Lazy-initialize like `supabase.ts`. |

### 2.7 `fs` / `child_process` / `path` — LOW (build-time only)

| File | Usage | Fix |
|------|-------|-----|
| `scripts/setup-check.mjs` | `node:fs`, `node:path` | Build-time only. No runtime impact. |
| `scripts/seed-admin.mjs` | `node:fs`, `node:path` | Build-time only. No runtime impact. |

---

## 3. Environment Variables

| Variable | Required | Neon/CF | Supabase | Notes |
|----------|----------|---------|----------|-------|
| `SUPABASE_URL` | Yes | — | ✅ | Supabase project URL. Keep for auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | ✅ | Service role. Keep for auth admin ops. |
| `SUPABASE_ANON_KEY` | Yes | — | ✅ | Anon key. Keep for auth. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | — | ✅ | Browser auth. Keep for auth. |
| `DATABASE_URL` | **NEW** | ✅ | — | Neon pooled connection string. |
| `NEON_DATABASE_URL` | **NEW** | ✅ | — | Neon pooled connection string (alias). |
| `NEON_DATABASE_URL_DIRECT` | **NEW** | ✅ | — | Neon direct connection for migrations. |
| `AI_KEYS_ENCRYPTION_SECRET` | Yes | ✅ | ✅ | AES-256-GCM key. Must be same or re-encrypt. |
| `CRON_SECRET` | Yes | ✅ | ✅ | Cron route protection. |
| `ANTHROPIC_API_KEY` | No | ✅ | ✅ | AI provider. |
| `NVIDIA_API_KEY` | No | ✅ | ✅ | AI provider. |
| `AI_PROVIDER` | No | ✅ | ✅ | Preferred AI provider. |
| `GOOGLE_CLIENT_ID` | No | ✅ | ✅ | Gmail OAuth. |
| `GOOGLE_CLIENT_SECRET` | No | ✅ | ✅ | Gmail OAuth. |
| `GOOGLE_OAUTH_REDIRECT_URI` | No | ✅ | ✅ | Gmail OAuth. |
| `CRAWLER_API_KEY` | No | ✅ | ✅ | Crawler API key. |
| `TALENT_OS_WEBHOOK_SECRET` | No | ✅ | ✅ | Webhook verification. |
| `NODE_ENV` | No | ✅ | ✅ | Production check. |
| `APP_BASE_URL` | **NEW** | ✅ | — | Production URL for callbacks. |
| `RESUME_STORAGE_PROVIDER` | No | — | ✅ | `supabase` or `sharepoint`. Keep until R2 migration. |
| `USAJOBS_API_KEY` | No | ✅ | ✅ | External API. |
| `USAJOBS_USER_AGENT` | No | ✅ | ✅ | External API. |
| `MS_CLIENT_ID` | No | ✅ | ✅ | SharePoint OAuth. |
| `MS_CLIENT_SECRET` | No | ✅ | ✅ | SharePoint OAuth. |
| `MS_TENANT_ID` | No | ✅ | ✅ | SharePoint OAuth. |
| `SHAREPOINT_SITE_ID` | No | ✅ | ✅ | SharePoint config. |
| `SHAREPOINT_DRIVE_FOLDER` | No | ✅ | ✅ | SharePoint config. |

---

## 4. Deployment Configuration

| Config | Status | Action |
|--------|--------|--------|
| `next.config.js` / `next.config.ts` | **Not found** | Create if needed for OpenNext. |
| `vercel.json` | ✅ Found | Contains 4 cron jobs. Will be replaced by Cloudflare Cron Triggers. |
| `wrangler.toml` / `wrangler.jsonc` | **Not found** | Create `wrangler.jsonc` for Cloudflare. |
| `open-next.config.ts` | **Not found** | Create for OpenNext + Cloudflare. |
| `package.json` scripts | ✅ Found | Add `cf:preview`, `cf:deploy`, `cf:typegen` scripts. |

---

## 5. Migration Risk Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| **Supabase Auth** | 🔴 HIGH | Keep temporarily. Replace with Clerk/Auth.js in Phase 2. |
| **Supabase Database (~120 files)** | 🟡 MEDIUM | Create Neon adapter. Migrate repositories incrementally. |
| **Supabase Storage** | 🟡 MEDIUM | Keep temporarily. Add R2 adapter later. |
| **Node `crypto` (secretCrypto)** | 🔴 HIGH | Rewrite with Web Crypto API. |
| **DOCX export (`docx`)** | 🔴 HIGH | Externalize to Node.js microservice or API. |
| **PDF export (`@react-pdf/renderer`)** | 🔴 HIGH | Externalize to Node.js microservice or API. |
| **PDF/DOCX parsing (`pdf-parse`, `mammoth`)** | 🔴 HIGH | Externalize or replace with WASM. |
| **Buffer usage** | 🟡 MEDIUM | Replace with `Uint8Array` + `TextEncoder`. |
| **Cron jobs (`vercel.json`)** | 🟡 MEDIUM | Move to Cloudflare Cron Triggers or external scheduler. |
| **Analytics RPC (`get_funnel_counts`)** | 🟡 MEDIUM | Reimplement as SQL query or Neon function. |

---

## 6. Recommended Phased Migration Plan

### Phase 1: Foundation (this sprint)
- Create Neon database and schema
- Create Neon adapter (`src/server/db/neon.ts`)
- Rewrite `secretCrypto.ts` with Web Crypto API
- Create `wrangler.jsonc` and `open-next.config.ts`
- Add Cloudflare env vars and scripts
- Update `.env.example.production`
- Migrate Chunk 5-10 repositories to Neon adapter
- Fix `Buffer` usage in critical paths

### Phase 2: Auth Independence (future sprint)
- Replace Supabase Auth with Clerk or Auth.js
- Update `profiles` table schema
- Update `middleware.ts` and `src/lib/auth.ts`
- Update login/signup routes
- Remove `auth.users` references

### Phase 3: Storage Independence (future sprint)
- Replace Supabase Storage with Cloudflare R2
- Update `src/lib/resumeStorage.ts` and `src/lib/storage.ts`
- Migrate existing files

### Phase 4: Export Externalization (future sprint)
- Move DOCX/PDF generation to a Node.js microservice
- Or replace with Cloudflare-compatible libraries
- Update `resumeExportService.ts`

### Phase 5: Full Cleanup (future sprint)
- Remove all remaining Supabase imports
- Remove `supabase.ts` and `supabaseRLS.ts`
- Remove Supabase env vars (if not needed for auth)
- Full end-to-end test

---

## 7. What NOT to Migrate (Keep as-is)

| Item | Reason |
|------|--------|
| `scripts/*.mjs` | Build-time scripts. No runtime impact. |
| `backend/` NestJS app | Separate service. Out of scope for frontend migration. |
| `src/lib/ai/*` providers (Anthropic, NVIDIA) | `fetch()`-based. Already Cloudflare-compatible. |
| `src/lib/atsFetchers.ts` | `fetch()`-based. Already Cloudflare-compatible. |
| `src/lib/integrations/teams.ts` | `fetch()`-based. Already Cloudflare-compatible. |
| UI components (`src/components/*`) | No server-side logic. Already compatible. |

---

## 8. Files That Must Change (Complete List)

### Critical (will break on Cloudflare without change)

1. `src/server/security/secretCrypto.ts` — Node crypto → Web Crypto
2. `src/lib/webhookEngine.ts` — Node crypto → Web Crypto
3. `src/lib/publicApiAuth.ts` — Node crypto → Web Crypto
4. `src/lib/integrations/googleGmail.ts` — Node crypto → Web Crypto
5. `src/lib/falood/docxExport.ts` — `docx` package → externalize
6. `src/lib/falood/pdfExport.ts` — `@react-pdf/renderer` → externalize
7. `src/lib/falood/skarionPdfDocument.tsx` — `@react-pdf/renderer` → externalize
8. `src/lib/resumeParsing.ts` — `pdf-parse`, `mammoth` → externalize
9. `src/lib/supabaseRLS.ts` — import-time `process.env` → lazy init
10. `src/app/api/export/docx/route.ts` — transitive `docx` dependency
11. `src/app/api/export/pdf/route.ts` — transitive `@react-pdf/renderer` dependency
12. `src/server/services/resumeExportService.ts` — transitive Node-only dependencies

### Moderate (will work with `nodejs_compat` but should be fixed)

13. `src/lib/integrations/sharepoint.ts` — `Buffer` → `Uint8Array`
14. `src/app/api/applications/[id]/proof/route.ts` — `Buffer` → `Uint8Array`
15. `src/app/api/chat/attachments/route.ts` — `Buffer` → `Uint8Array`
16. `src/app/api/candidates/[id]/photo/route.ts` — `Buffer` → `Uint8Array`
17. `src/app/api/candidates/[id]/resumes/route.ts` — `Buffer` → `Uint8Array`
18. `src/app/api/candidates/[id]/resume/route.ts` — `Buffer` → `Uint8Array`
19. `src/lib/resumeStorage.ts` — `Buffer` type → `Uint8Array` type

### Database migration (incremental — start with repositories)

20. `src/server/repositories/jobsRepository.ts` — Supabase → Neon
21. `src/server/repositories/candidatesRepository.ts` — Supabase → Neon
22. `src/server/repositories/applicationsRepository.ts` — Supabase → Neon
23. `src/server/repositories/applicationPacketsRepository.ts` — Supabase → Neon
24. `src/server/repositories/applicationKeywordsRepository.ts` — Supabase → Neon
25. `src/server/repositories/applicationResumeVersionsRepository.ts` — Supabase → Neon
26. `src/server/repositories/applicationResumeSuggestionsRepository.ts` — Supabase → Neon
27. `src/server/repositories/applicationResumeExportsRepository.ts` — Supabase → Neon
28. `src/server/repositories/aiKeyRepository.ts` — Supabase → Neon
29. `src/server/repositories/targetJobsRepository.ts` — Supabase → Neon
30. `src/lib/supabase.ts` — Swap implementation to use Neon adapter (keep interface)

---

## 9. Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Keep Supabase Auth temporarily | Deeply embedded. 4 auth files + `auth.users` FKs. Replacement requires auth system migration. |
| 2 | Keep Supabase Storage temporarily | 9 files use it. R2 migration is a separate sprint. Storage interface is already pluggable. |
| 3 | Neon as main database | All app data tables move to Neon. Supabase client remains only for auth and storage. |
| 4 | Use `@neondatabase/serverless` driver | Cloudflare-compatible. Uses `fetch()` under the hood. No persistent connections. |
| 5 | Rewrite `secretCrypto.ts` with Web Crypto | Node crypto is not available on Cloudflare Workers. Web Crypto supports AES-256-GCM. |
| 6 | Externalize DOCX/PDF export | `docx` and `@react-pdf/renderer` are Node-only. No Cloudflare-compatible alternative with same features. |
| 7 | Replace `Buffer` with `Uint8Array` | `Buffer` requires Node compat. `Uint8Array` + `TextEncoder` are standard Web APIs. |
| 8 | Use `nodejs_compat` flag | Allows some Node APIs (like `Buffer` if not fully replaced) while migrating. |
| 9 | Migrate repositories incrementally | ~120 files use `supabase.from()`. Full migration is too large for one sprint. Start with repositories. |
| 10 | Keep `src/lib/supabase.ts` interface | The proxy pattern means we can swap the internal implementation without changing ~120 import sites. |

---

*End of audit document.*
