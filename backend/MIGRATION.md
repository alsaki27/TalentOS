# Supabase to NestJS Migration Notes

This backend is the NestJS/TypeORM replacement for the Supabase-backed Next.js API routes.

## Current Scope

Converted in this pass:

- `profiles` -> Clerk-aware `ProfileEntity`
- `candidates`
- `resumes`
- `jobs`
- `companies`
- `company_people`
- `applications`
- `application_events`
- `application_comments`
- `job_comments`
- `audit_logs`
- `import_profiles`
- `import_sources`
- `import_runs`
- `saved_job_searches`
- `integration_oauth_states`
- `integration_accounts`
- `integration_events`
- `public_api_keys`
- `chat_conversations`
- `chat_messages`
- `ai_digests`
- `job_crawler_status`

All entities extend `src/entities/base.entity.ts`, which provides:

- `id`
- `createdAt`
- `updatedAt`
- `isDeleted`
- `deletedAt`

## Auth Migration

Supabase Auth is replaced by Clerk.

Old shape:

- `profiles.user_id` referenced Supabase `auth.users.id`

New shape:

- `profiles.id` is the internal UUID primary key.
- `profiles.clerk_user_id` stores the Clerk user ID.
- relations that previously pointed at `profiles.user_id` now point at `profiles.id`.

The data migration script must map old Supabase auth user IDs to Clerk user IDs before importing profile-owned records.

## RLS Migration

Supabase RLS was enabled with no policies, because the Next app used the service-role key server-side.

In NestJS, authorization is application-level:

- `AuthorizationService.profileFor()` resolves the Clerk user to an active internal profile.
- `AuthorizationService.requireRole()` enforces role gates.
- `AuthorizationService.assertApplicationVisibility()` ports the application-engineer visibility rule:
  application engineers only access tickets assigned to their profile, email, or display name.

## Implemented Modules

Each module follows the requested structure:

- `dtos.ts` with `zod` + `createZodDto`
- `[feature].service.ts`
- `[feature].controller.ts`
- `[feature].module.ts`

Implemented:

- `profiles`
- `candidates`
- `jobs`
- `companies`
- `applications`
- `public-api-keys`

Still to port as service/controller modules:

- import sources + import runs
- saved job searches
- integrations: Gmail, TalentOS/Teams events
- job crawler heartbeat/push ingestion
- analytics
- follow-up/reminder read model
- chat + AI digest
- candidate portal public token routes
- resume/file storage adapter

## Local Setup

```bash
cd backend
npm install
copy .env.example .env
npm run typecheck
npm run start:dev
```

Swagger docs:

```text
http://localhost:4000/docs
```

## Environment

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/skarion
CLERK_SECRET_KEY=sk_test_...
CORS_ORIGIN=http://localhost:3015
TYPEORM_SYNCHRONIZE=false
DATABASE_SSL=false
PORT=4000
```

Use real migrations for production. `TYPEORM_SYNCHRONIZE=true` is only acceptable for throwaway local databases.
