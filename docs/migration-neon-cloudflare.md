# Migration Readiness: Neon Postgres + Cloudflare Workers

**Status:** This document is a living guide. The app is still Supabase-backed today. Future target is Neon Postgres + Cloudflare Workers/OpenNext.

## Current state (2026-06-19)

The TalentOS frontend runs on Vercel + Supabase (Postgres + Auth + Storage). This is the working, deployed architecture. Nothing is being torn down.

Chunk 3.5 added portability guardrails to prevent future feature chunks from deepening Supabase lock-in:

- `src/server/repositories/jobsRepository.ts` — data-access abstraction for jobs. New workflow routes should call this instead of `supabase.from("jobs")`.
- `src/server/repositories/aiKeyRepository.ts` — data-access abstraction for AI API keys.
- `src/server/security/secretCrypto.ts` — encryption helper. Uses Node crypto today; marked for Web Crypto migration when moving to Cloudflare Workers.
- `src/server/services/aiProvider.ts` — AI provider management service with DB fallback support.
- Admin AI API key manager (`/api/admin/ai-keys`, `/ops` panel) — encrypted key storage, health testing, priority ordering.

## Rule for future chunks

**No new direct `supabase.from()` calls in feature routes.** All new features must go through a repository or service abstraction. Existing code continues to work; the rule applies only to new feature routes.

## What must be abstracted before migration

| Layer | Current | Target | Abstraction status |
|---|---|---|---|
| Database queries | Supabase client (`@/lib/supabase`) | Neon Postgres + `pg` or `neon` driver | `jobsRepository`, `aiKeyRepository` started; rest of app still direct |
| Auth / session | Supabase Auth | Clerk (or Cloudflare Access) | Not abstracted yet |
| File storage | Supabase Storage | R2 or SharePoint | `src/lib/resumeStorage.ts` has pluggable interface; needs Cloudflare-aware adapter |
| Realtime / SSE / crawler status | Supabase Realtime | Cloudflare Durable Objects or WebSocket | Not abstracted yet |
| Cron jobs | Vercel Cron | Cloudflare Cron Triggers | Not abstracted yet |
| Public API keys | In-app table + SHA-256 | Same table, but auth middleware changes | Service layer (`@/lib/publicApiAuth.ts`) exists; runtime gating may need work |
| Activity / audit logs | Supabase table writes | Same table, but via portable SQL | `logActivity()` in `@/lib/activity.ts` is a thin wrapper; can be adapted |
| AI key secret encryption | Node `crypto` (AES-256-GCM) | Cloudflare Web Crypto (`crypto.subtle`) | Interface is stable; implementation needs swap |

## Cloudflare compatibility notes

1. **Avoid Node-only APIs in runtime routes.** `src/server/security/secretCrypto.ts` uses Node `crypto.createCipheriv`. For Cloudflare, replace with `crypto.subtle.encrypt` / `crypto.subtle.decrypt` using the same AES-256-GCM algorithm. The exported interface (`encryptSecret`, `decryptSecret`, `fingerprintKey`, `isEncryptionAvailable`) should remain unchanged.
2. **Avoid long-lived DB connections.** Neon supports serverless/edge via `neon` driver with `ws` pooling. Keep DB operations request-scoped.
3. **Secrets must move to Cloudflare Worker environment variables/secrets.** `AI_KEYS_ENCRYPTION_SECRET`, `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, etc. should be bound as secrets, not stored in `.env`.
4. **OpenNext compatibility.** If using OpenNext for Next.js on Cloudflare, ensure dynamic routes and API routes are compatible with the edge runtime. Test `src/app/api/admin/ai-keys/[id]/test/route.ts` specifically — it does `fetch()` to external APIs, which is well-supported on Cloudflare Workers.

## Neon notes

1. **Keep SQL portable Postgres.** The migration `20260619193000_ai_api_keys.sql` uses plain Postgres types (`uuid`, `text`, `timestamptz`, `integer`, `boolean`) and standard features (`gen_random_uuid()`, `now()`). No Supabase-specific extensions.
2. **Avoid Supabase-specific RPC/storage/auth coupling in new feature code.** The `jobsRepository` and `aiKeyRepository` use the Supabase client internally, but their interfaces are pure TypeScript — swapping the implementation to use a `pg` pool or `neon` client is a file-local change.
3. **Keep migrations compatible with plain Postgres where possible.** The existing migrations already use standard SQL; the one thing to watch is `auth.users` references (e.g. `profiles.user_id`). If migrating to Clerk, the `profiles` table will need a `clerk_user_id` column, and FK references should be updated.

## Recommended migration sequence (when the team decides to do it)

1. **Abstract remaining direct Supabase calls** into repositories/services. Start with the highest-touch tables: `candidates`, `applications`, `profiles`.
2. **Swap `secretCrypto.ts` to Web Crypto.** Do this before any Cloudflare deploy.
3. **Add a Neon database connection** alongside the existing Supabase connection. Run a dual-write or read-replica period to validate.
4. **Migrate auth to Clerk.** Write and run the one-time user-mapping script. The NestJS backend already has this on its roadmap.
5. **Switch hosting to Cloudflare Workers** with OpenNext. Keep Vercel as a staging environment until confident.
6. **Migrate storage** to R2 or keep SharePoint (if that's the long-term target). The `resumeStorage.ts` pluggable interface makes this straightforward.
7. **Migrate realtime** to Durable Objects or a lightweight polling fallback. The crawler status page and import-run live updates are the main consumers.

## What not to do before migration

- Do not provision a second Postgres instance "just to test Neon." Use the direct connection string from the existing Supabase project (Settings → Database → Connection string) through the pooler. This is free and avoids a future data migration step.
- Do not start the auth migration before the database abstraction is done. The auth layer touches almost every route.
- Do not migrate cron jobs until the app is actually running on Cloudflare. Vercel Cron works fine until then.

## Chunk 4 quick-application UI guidance

When implementing the quick-application modal (Chunk 4):
- Call `POST /api/jobs/analyze` and `POST /api/jobs/from-jd` — these routes already exist and use the repository/service layer.
- Do NOT add direct `supabase.from()` calls in the modal or any new feature routes.
- Use `logActivity()` for activity logging — it's the stable abstraction.
- Use `getActiveProviderAsync()` for AI calls — it supports DB fallback keys.
