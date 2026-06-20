# Plan: Neon Adapter + Cloudflare Workers Migration

## Stage 1: New Files (Create)
1. `.env.example.production` — production env template with Neon vars
2. `wrangler.jsonc` — Cloudflare Workers config
3. `open-next.config.ts` — OpenNext Cloudflare config
4. `src/server/db/neon.ts` — Neon serverless driver adapter
5. `src/server/db/index.ts` — Database abstraction layer

## Stage 2: Package & Build Config
6. Update `package.json` — add deps, devDeps, and Cloudflare scripts

## Stage 3: Web Crypto Rewrites (Security-Critical)
7. Rewrite `src/server/security/secretCrypto.ts` — Web Crypto API, async signatures
8. Update `src/server/repositories/aiKeyRepository.ts` — await encryptSecret, decryptSecret, fingerprintKey
9. Rewrite `src/lib/webhookEngine.ts` — Web Crypto HMAC, async signature
10. Rewrite `src/lib/publicApiAuth.ts` — Web Crypto random/hash, async signatures
11. Update `src/lib/apiKeyAuth.ts` — await hashPublicApiKey
12. Update `src/app/api/api-keys/route.ts` — await generatePublicApiKey, hashPublicApiKey

## Stage 4: Lazy Initialization & Buffer Fixes
13. Fix `src/lib/supabaseRLS.ts` — lazy-init like supabase.ts
14. Fix `src/lib/resumeStorage.ts` — accept Uint8Array instead of Buffer
15. Fix `src/lib/resumeParsing.ts` — accept Uint8Array in extractText
16. Fix `src/lib/integrations/sharepoint.ts` — accept Uint8Array in uploadToSharePoint
17. Fix 5 upload routes — replace Buffer.from with Uint8Array

## Stage 5: Verification
18. Type-check the build to catch missing awaits or type mismatches.

## Async Signature Changes & Callers

| Function | File | Old | New | Callers |
|----------|------|-----|-----|---------|
| encryptSecret | secretCrypto.ts | sync | async | aiKeyRepository.ts (createAiKey, updateAiKey) |
| decryptSecret | secretCrypto.ts | sync | async | aiKeyRepository.ts (getAiKeyWithDecryptedKey) |
| fingerprintKey | secretCrypto.ts | sync | async | aiKeyRepository.ts (createAiKey, updateAiKey) |
| generateWebhookSignature | webhookEngine.ts | sync | async | webhookEngine.ts (deliverWebhook) |
| generatePublicApiKey | publicApiAuth.ts | sync | async | api-keys/route.ts (POST) |
| hashPublicApiKey | publicApiAuth.ts | sync | async | api-keys/route.ts (POST), publicApiAuth.ts (requirePublicApiScope), apiKeyAuth.ts (validateApiKey) |

