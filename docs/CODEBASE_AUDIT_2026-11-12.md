# TalentOS codebase audit — 2026-11-12

## Scope and method

Reviewed the current `neon-cloudflare-migration` baseline at `5f5bf4f7` in an isolated branch. The repository contains 1,238 tracked files under `src`, including 444 API route files and 255 TSX files. I scanned the tracked API, UI, database, AI, auth, and service code for risky request methods, HTML injection, fabricated metrics, transaction boundaries, secret handling, and test coverage. I then inspected the relevant call paths and fixed the issues below. This is a broad static audit with targeted deep review, not a line-by-line security certification or production penetration test.

## Changes in this branch

| Priority | Finding | Evidence | Change |
| --- | --- | --- | --- |
| Critical | The public staff signup endpoint created an active application-engineer account for anyone after the first admin existed, with email marked verified. | `src/app/api/auth/signup/route.ts`, `src/app/login/page.tsx`, `src/app/api/users/route.ts` | Restrict anonymous signup to first-time workspace setup; the login page only offers it before an account exists. Existing admins can provision staff through Team. Initial bootstrap authorization and concurrency still need a dedicated setup-secret design. |
| Critical | Any signed-in staff member could create a public API key with destructive `candidates:delete`, `jobs:delete`, or `applications:delete` scopes. The UI hid the form from non-admins, but the API routes only required a session and middleware allowed the paths. | `src/app/api/api-keys/route.ts`, `src/app/api/api-keys/[id]/route.ts`, `src/lib/publicApiAuth.ts`, `src/lib/auth-edge.ts` | Require an active admin profile in all key management handlers and deny non-admin access in middleware. Added a role regression test. |
| Critical | `GET /api/admin/run-archive` created a table, copied old jobs, then deleted jobs. Its separate `execute("BEGIN")`, `query(...)`, and `execute("COMMIT")` calls were not guaranteed to use one connection, so the purported transaction did not protect the delete. | `src/app/api/admin/run-archive/route.ts` and `src/server/db/neon.ts` | Retired the one-off HTTP route with a non-mutating 410 response. Any future archive needs a reviewed, explicit migration or script with an actual transaction and reconciliation. |
| High | `GET /api/admin/repair-ai-queue?execute=1` retried failed workflows from a navigation. | `src/app/api/admin/repair-ai-queue/route.ts` | GET is now non-mutating and returns 405. The authenticated POST path remains for deliberate repairs. |
| High | Saved email template bodies and supplied preview data were inserted into the DOM as HTML. | `src/app/communications/templates/page.tsx`, `src/components/TemplateEditor.tsx` | React renders preview bodies as escaped text while preserving line breaks with `white-space: pre-wrap`. |
| Medium | Sequence create/update wrote parent and steps in separate database operations. Invalid steps could leave a new sequence without steps or erase existing steps; an empty replacement generated invalid `INSERT ... VALUES` SQL. | `src/app/api/email-sequences/route.ts` | Parent and step writes now run in one transaction on the supported Postgres and Neon adapters. Empty step arrays are valid; malformed and oversized arrays are rejected. |
| Medium | Sequence list showed random open and reply percentages on every render. | `src/app/communications/sequences/page.tsx` | Shows `Not tracked` until real event-based measurements exist. |
| Medium | Public health response disclosed database driver, config presence, server version, and raw connection errors. | `src/app/api/health/route.ts`, `src/middleware.ts` | Public response now contains only status and duration, with no-store caching. Monitoring retains HTTP 200/503 behavior. |

## Follow-up work for separate review

1. Review existing `public_api_keys` against creator roles, scopes, issue dates, and recent use. Review existing staff profiles and `auth.signup` audit events for unauthorized registrations. This code change prevents new cases; it does not retroactively revoke keys or accounts.
2. `npm audit --omit=dev` reported 11 production dependency advisories on 2026-11-12: 2 critical, 8 high, 1 moderate. The direct Next.js dependency is `14.2.35`, with npm proposing a major-version fix; `dompurify@3.4.12` arrives through `jspdf@4.2.1`. Assess advisories and reachable paths, update compatible packages in a separate dependency PR, and stage the Next.js/OpenNext migration rather than applying a blind major upgrade. Advisory counts do not establish exploitability in TalentOS.
3. `src/server/db/neon.ts` sets `rejectUnauthorized: false` for direct Postgres TLS. Provision a trusted certificate/CA and stage the switch to verified TLS before changing that flag; a code-only flip could take production down.
4. `src/server/auth/jwt.ts` falls back from `JWT_SECRET` to `AI_KEYS_ENCRYPTION_SECRET`. Verify runtime secret configuration and rotate toward a dedicated JWT secret with a deliberate session migration.
5. `src/app/api/mcp/route.ts` performs application-stage updates and audit-history inserts as separate operations. Review its credential scopes, candidate/job/base-resume ownership checks, idempotency behavior, and transaction boundaries before expanding machine access. This branch does not change that production workflow.
6. Add real open/reply event aggregation before displaying engagement rates. A generated percentage must never be treated as campaign performance.
7. Add an auth/HTTP-method regression gate for state-changing API routes. This review identified two unsafe GET handlers, but a repository-wide AST audit and production threat model remain useful.

## Verification and release notes

`npm run typecheck` passed. Changed-file ESLint produced no errors; the two communications pages retain their pre-existing `useEffect` dependency warnings. The focused auth and endpoint checks passed (14 tests). The full Vitest suite passed: 176 files, 1,574 tests passed, 6 skipped. `git diff --check` passed. These checks use local fixtures and mocks; they do not prove production behavior or database transaction compatibility.

The branch contains no database migration and does not alter existing rows. The archive endpoint intentionally returns 410 for any old internal link; repository search found no application caller. The health endpoint retains HTTP 200/503 behavior while omitting diagnostics from the public body. Verify the sequence transaction against both supported database drivers in staging and review first-account bootstrap behavior before merging. No production deployment or live database mutation was performed during this audit.
