# Chunk 3.5 Execution Plan: Portability Guardrails + Admin AI API Key Manager

## Progress Checklist

| # | Item | Target | Status | % |
|---|---|---|---|---|
| 1 | Audit direct Supabase usage in Chunk 2/3 code | Audit report | pending | 0% |
| 2 | Service/repository abstraction design | `src/server/repositories/jobsRepository.ts` | pending | 0% |
| 3 | AI key manager database schema | Migration + types | pending | 0% |
| 4 | AI key manager API routes | 5 admin routes | pending | 0% |
| 5 | Admin UI | `/ops` panel addition | pending | 0% |
| 6 | AI fallback integration | `src/server/services/aiProvider.ts` | pending | 0% |
| 7 | Validation/docs | Typecheck, build, docs | pending | 0% |

## Stage 1: Audit & Abstraction Design (0% → 30%)
- Read Chunk 2/3 code files
- Identify direct `supabase.from("jobs")` calls
- Design repository pattern
- Document audit findings

## Stage 2: Schema & Repository (30% → 50%)
- Create `jobsRepository.ts`
- Create migration for `ai_api_keys` table
- Add `src/server/security/secretCrypto.ts`
- Create `aiKeyRepository.ts`

## Stage 3: Admin API Routes (50% → 70%)
- `GET /api/admin/ai-keys`
- `POST /api/admin/ai-keys`
- `PATCH /api/admin/ai-keys/[id]`
- `POST /api/admin/ai-keys/[id]/disable`
- `POST /api/admin/ai-keys/[id]/test`

## Stage 4: Admin UI (70% → 85%)
- Add AI key manager panel to `/ops`
- Server component table + client actions
- Status badges, test buttons, add/edit forms

## Stage 5: AI Fallback Integration (85% → 95%)
- `getEnabledAiKeys()` service
- `testAiKey()` service
- `recordAiKeySuccess()` / `recordAiKeyFailure()`
- Update `getActiveProvider()` to use DB keys as fallback
- Track usage/failure counts

## Stage 6: Docs & Validation (95% → 100%)
- `docs/migration-neon-cloudflare.md`
- Update README, STATUS_REPORT, HANDOVER, ROADMAP, security-matrix
- Typecheck, build, git push

## Rules
- NO full Neon migration
- NO Cloudflare deployment
- NO breaking existing Supabase behavior
- NO quick application modal
- NO auth migration
- All new feature routes must use repository/service abstractions
- DB keys are additional backups, env keys still work
- Keys encrypted, never returned to browser
- Admin-only access
- Clean setup error if `AI_KEYS_ENCRYPTION_SECRET` missing

## Files to create
- `supabase/migrations/20260619XXXXXX_ai_api_keys.sql`
- `src/server/repositories/jobsRepository.ts`
- `src/server/repositories/aiKeyRepository.ts`
- `src/server/security/secretCrypto.ts`
- `src/server/services/aiProvider.ts`
- `src/app/api/admin/ai-keys/route.ts`
- `src/app/api/admin/ai-keys/[id]/route.ts`
- `src/app/api/admin/ai-keys/[id]/test/route.ts`
- `src/app/api/admin/ai-keys/[id]/disable/route.ts`
- `src/app/ops/components/ai-key-manager.tsx` (or inline in ops page)
- `docs/migration-neon-cloudflare.md`

## Files to modify
- `src/app/api/jobs/analyze/route.ts` — use repository if possible
- `src/app/api/jobs/from-jd/route.ts` — use repository
- `src/app/ops/page.tsx` — add AI key panel
- `src/lib/ai/index.ts` — integrate DB keys as fallback
- `README.md`, `STATUS_REPORT.md`, `HANDOVER.md`, `ROADMAP.md`, `docs/security-matrix.md`
- `.env.example` (add `AI_KEYS_ENCRYPTION_SECRET`)

## Env vars to add
- `AI_KEYS_ENCRYPTION_SECRET` — encryption key for API keys
