# Security Matrix

Last reviewed: 2026-06-19.

TalentOS enforces authorization in the Next.js app layer with `src/middleware.ts`,
`getCurrentUserContext()`, `requireCurrentUser(roles?)`, public API scopes, and a few
route-specific checks. Supabase RLS is enabled as a placeholder, but there are no RLS
policies; browser code does not query Supabase directly.

## Role Constants

| Constant | Roles |
|---|---|
| `MASTER_DATA_MANAGER_ROLES` | `admin`, `manager`, `recruiter` |
| `ASSIGNMENT_MANAGER_ROLES` | `admin`, `manager`, `recruiter` |
| `APPLICATION_WORKER_ROLES` | `admin`, `manager`, `application_engineer`, `recruiter` |
| `DESTRUCTIVE_MANAGER_ROLES` | `admin`, `manager` |
| `FALOOD_REVIEWER_ROLES` | `admin`, `manager`, `reviewer` |

## Internal Routes

| Route | Methods | Allowed roles / auth | Status |
|---|---:|---|---|
| `/api/candidates` | `GET` | authenticated staff | Paginated/filterable list. |
| `/api/candidates` | `POST` | `MASTER_DATA_MANAGER_ROLES` | Candidate create is gated. |
| `/api/candidates/[id]` | `GET` | authenticated staff via middleware | Candidate detail is staff-only. |
| `/api/candidates/[id]` | `PATCH` | `MASTER_DATA_MANAGER_ROLES` | Candidate edit is gated. |
| `/api/candidates/[id]` | `DELETE` | `DESTRUCTIVE_MANAGER_ROLES` | Candidate delete is gated. |
| `/api/jobs` | `GET` | authenticated staff via middleware | Paginated/filterable list. |
| `/api/jobs` | `POST` | `MASTER_DATA_MANAGER_ROLES` | Job create is gated. |
| `/api/jobs/analyze` | `POST` | `APPLICATION_WORKER_ROLES` | JD analyzer (parse-only). Returns structured analysis from raw JD text. Does not create jobs. Excludes `reviewer` role. |
| `/api/jobs/from-jd` | `POST` | `MASTER_DATA_MANAGER_ROLES` | Full JD workflow: parse → dedup → create job. Three-pass duplicate detection (exact URL, exact normalized match, fuzzy Levenshtein). Returns 409 if duplicates found unless `forceCreate: true`. Creates a `pasted_jd` source job on success. |
| `/api/jobs/[id]` | `GET` | authenticated staff via middleware | Job detail is staff-only. |
| `/api/jobs/[id]` | `PATCH` | `MASTER_DATA_MANAGER_ROLES` | Job edit is gated. |
| `/api/jobs/[id]` | `DELETE` | `DESTRUCTIVE_MANAGER_ROLES` | Job delete is gated. |
| `/api/applications` | `GET` | authenticated staff | Paginated list. |
| `/api/applications` | `POST` | authenticated staff; assignment tickets require `ASSIGNMENT_MANAGER_ROLES` | Normal application create is staff-authenticated; assigning/stacking tickets is manager/recruiter/admin gated. |
| `/api/applications/[id]` | `PATCH` | authenticated staff; assignment/review decisions require `ASSIGNMENT_MANAGER_ROLES` | Status updates are staff-authenticated. Assignment edits and manager review decisions are gated. Application engineers cannot mark `applied` while review is pending/changes-requested unless a manager approves. |
| `/api/applications/[id]` | `DELETE` | `ASSIGNMENT_MANAGER_ROLES` | Application/assignment delete is gated. |
| `/api/applications/[id]/proof` | `GET`, `POST` | `APPLICATION_WORKER_ROLES` | Proof upload/list exists and is role-gated. |
| `/api/applications/[id]/close` | `PATCH` | `APPLICATION_WORKER_ROLES` | Close action is worker-role gated and can require proof. Consider adding explicit ownership checks before broad application-engineer rollout. |
| `/api/application-queue` | `GET` | authenticated staff; `application_engineer` scoped to own assignments | Queue is paginated/filterable and scoped by assigned user id/email/display name for application engineers. |
| `/api/follow-ups` | `GET` | authenticated staff; `application_engineer` scoped to own assignments | Follow-ups are paginated and scoped for application engineers. |
| `/api/users` | `GET` | authenticated staff | Team list. |
| `/api/users` | `POST` | `admin` | Team account creation is admin-only. |
| `/api/users/[id]` | `PATCH` | `admin` | Role/status updates are admin-only. |
| `/api/audit-logs` | `GET` | `admin` | Audit log is admin-only. |
| `/api/api-keys` | `GET`, `POST` | `admin` | Public API key management is admin-only. |
| `/api/api-keys/[id]` | `DELETE` | `admin` | Public API key revocation is admin-only. |
| `/api/ops/status` | `GET` | `admin` | System status is admin-only. |
| `/api/ops/backups` | `GET` | `admin` | Stored backup list is admin-only. `POST` is retired; use `/api/ops/restore`. |
| `/api/ops/export` | `GET` | `admin` | On-demand backup export is admin-only. |
| `/api/ops/restore` | `POST` | `admin` + `RESTORE TALENTOS BACKUP` confirmation | Backup restore upserts rows and logs `backup.restored`. |
| `/api/ops/digests` | `GET`, `POST` | `admin` | Digest history/manual generation is admin-only. |
| `/api/ops/categorize` | `GET`, `POST` | `admin` | Categorization review/requeue/process actions are admin-only. |
| `/api/admin/ai-keys` | `GET`, `POST` | `admin` | AI API key management: list metadata, add new encrypted key. Returns 503 if `AI_KEYS_ENCRYPTION_SECRET` is not set. |
| `/api/admin/ai-keys/[id]` | `PATCH`, `DELETE` | `admin` | Update label/priority/enable/replace key, or soft-disable a key. |
| `/api/admin/ai-keys/[id]/test` | `POST` | `admin` | Test a single AI key by sending a tiny request. Updates status, last_tested_at, success/failure counts. |
| `/api/import/*` | `POST` | `MASTER_DATA_MANAGER_ROLES` | CSV/ATS/LinkedIn/career-page/normalizer imports are manager/recruiter/admin gated. |
| `/api/import-sources*` | `GET`, `POST`, `PATCH`, `DELETE`, run actions | `MASTER_DATA_MANAGER_ROLES` | Saved import source management/run actions are manager/recruiter/admin gated. |
| `/api/integrations/gmail/start` | `GET` | authenticated staff; shared mailbox requires `DESTRUCTIVE_MANAGER_ROLES` | Staff Gmail linking is authenticated; shared mailbox linking is admin/manager. |
| `/api/integrations/gmail/[id]` | `DELETE` | owner or `DESTRUCTIVE_MANAGER_ROLES` for shared mailbox | Disconnect is gated by ownership/shared mailbox role. |
| `/api/integrations/talent-os/events` | `GET` | `DESTRUCTIVE_MANAGER_ROLES` | Integration events are admin/manager. |
| `/api/webhooks*` | management/test/event reads | `DESTRUCTIVE_MANAGER_ROLES` | Webhook management is admin/manager. |
| `/api/interviews*` | create/update/delete/panel management | `MASTER_DATA_MANAGER_ROLES` for mutations; authenticated staff for reads/scorecards | Interview management is gated. |
| `/api/base-resumes*`, `/api/application-packets*`, `/api/application-resume-versions*`, `/api/target-jobs*` | worker-facing create/edit/delete | `APPLICATION_WORKER_ROLES` for normal work; `DESTRUCTIVE_MANAGER_ROLES` for deletes | Falood/resume workflow routes are role-gated, but ownership rules should be audited before wider rollout. |
| `/api/cron/*` | `GET` | `CRON_SECRET` bearer token | Cron routes fail closed without `CRON_SECRET`. |
| `/api/integrations/crawler/jobs`, `/heartbeat` | `POST` | `CRAWLER_API_KEY`, integration keys, or `CRON_SECRET` depending route logic | Bot ingestion is bearer-secret gated. |

## Public Or Token Routes

| Route | Auth model | Notes |
|---|---|---|
| `/api/portal/[token]` and `/portal/[token]` | Candidate magic-link token | Candidate self-login is not implemented. Portal token expiry/revocation fields exist. |
| `/api/portal/[token]/gmail/start`, `/status` | Candidate magic-link token | Candidate Gmail linking exists, but Gmail intelligence/classification is not built. |
| `/api/integrations/gmail/callback` | OAuth state | Callback validates OAuth state. |
| `/api/integrations/talent-os/webhook` | Shared secret | External inbound webhook fails closed without secret. |
| `/api/auth/login` | Supabase password auth | Public login endpoint. |
| `/api/auth/logout` | Clears cookies | Public but only clears local session cookies. |
| `/api/auth/me`, `/api/auth/password` | Session cookie inside route | Under `/api/auth/*` middleware allowlist, but route checks current user. |

## Public API Scope Routes

The `/api/public/*` integration surface is API-key gated by `requirePublicApiScope()`.
Keys are SHA-256 hashed at rest and support expiry/revocation.

| Scope | Routes |
|---|---|
| `candidates:read/write/delete` | `/api/public/candidates`, `/api/public/candidates/[id]` |
| `jobs:read/write/delete/import/shortlist` | `/api/public/jobs`, `/api/public/jobs/[id]`, `/api/public/jobs/import`, `/api/public/jobs/[id]/shortlist` |
| `applications:read/write/delete/assign/status/comment` | `/api/public/applications`, `/api/public/applications/[id]`, timeline/comments routes |
| `companies:read/write/delete` | `/api/public/companies`, `/api/public/companies/[id]`, company jobs/applications/people routes |
| `company_people:read/write/delete` | `/api/public/company-people`, `/api/public/company-people/[id]`, company people routes |
| `events:read/write/acknowledge` | `/api/public/events`, `/api/public/events/[id]` |
| `reminders:read/write` | `/api/public/reminders`, `/api/public/reminders/[applicationId]` |
| `analytics:read` | `/api/public/analytics/overview` |

## Remaining Security Follow-Ups

- Route-level role gates now cover the major mutations, assignments, deletes, and admin
  surfaces. Before broad offshore/team rollout, do a final route-by-route ownership review,
  especially for worker-facing resume/Falood routes and application close actions.
- Supabase RLS policies are still not implemented. That is acceptable only while all data
  access remains server-side through the service-role client.
- Candidate self-login, Gmail intelligence/classification, resume tailoring AI, NestJS
  migration, and Cloudflare/D1/R2 migration are not part of this pass.
