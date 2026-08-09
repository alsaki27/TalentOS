# TalentOS Production Stabilization and Candidate Matching

Last updated: 2026-08-09  
Canonical production site: `https://talent.skarion.com`

## Purpose

This is the single implementation, rollout, and verification handover for:

- staff and candidate Google login;
- candidate Google Authenticator MFA and recovery codes;
- optional candidate Gmail consent and synchronization;
- base-resume search-keyword generation and manager approval;
- candidate-to-job matching with Application Engineer review;
- the existing nightly Job Agent and Job CEO pipeline.

The system never applies to a job or sends an email automatically. Candidate matching creates an auditable recommendation. Only an AE approval creates an internal application and starts the existing resume-tailoring workflow. External submission remains a human action.

## Implemented architecture

```text
Indeed + LinkedIn + Google + OpenJobData
  -> existing Job Agent and Job CEO
  -> normalized canonical jobs
  -> approved, current base-resume search profiles
  -> deterministic candidate/job scoring and hard gates
  -> Candidate Match Review
  -> AE approval
  -> one idempotent internal application
  -> existing application AI workflow
  -> ready_for_review
  -> human application submission
```

### Google identity

- All production redirects use the canonical TalentOS origin, never an incoming Worker request origin.
- OAuth state is random, stored as a SHA-256 hash, expires after ten minutes, and is consumed once.
- Candidate Google login uses only `openid email profile`; Gmail permission is a separate consent flow.
- A new candidate Google identity can be linked only through a valid invite resolved before OAuth starts.
- `google_sub` and candidate account email remain database-unique.
- Google must report a verified email.
- Staff Google login accepts an existing staff profile. It can bootstrap the first admin only when no profile exists; it cannot openly create later staff accounts.
- Missing runtime configuration returns a controlled readiness/configuration response instead of relying on an unexplained HTTP 500.

Exact Google Cloud authorized redirect URIs:

```text
https://talent.skarion.com/api/auth/google/callback
https://talent.skarion.com/api/portal/auth/google/callback
https://talent.skarion.com/api/integrations/gmail/callback
```

Exact authorized JavaScript origin:

```text
https://talent.skarion.com
```

### Candidate MFA

- Authenticator setup secrets are encrypted before storage.
- The login screen supports a six-digit TOTP or a full recovery code.
- Recovery codes are hashed, atomically consumed, and can be used only once.
- Failed verification increments atomically.
- Five failures lock verification for fifteen minutes.
- A successful challenge resets the counter.
- Logout clears the full candidate session, MFA-pending session, and OAuth-state cookies.
- Codes, JWTs, TOTP secrets, and recovery codes are never written to logs.

### Candidate Gmail

- Authenticated start route: `/api/portal/me/gmail/start`.
- Compatibility route retained: `/api/portal/integrations/gmail/start`.
- Candidate consent requests `gmail.modify` separately from Google login.
- The callback consumes state atomically, verifies the granted scope, encrypts tokens, and preserves an existing refresh token when Google omits a new one.
- Only one active candidate Gmail account is allowed per candidate.
- The portal shows connection state and supports connect/reconnect, pause/resume, retention, imported-history deletion, and disconnect/revocation.
- Initial synchronization begins at the successful email consent time.
- Personal transaction, account-security, travel/medical, job-alert, marketing, and newsletter messages are suppressed before AI analysis and storage.
- Gmail labels and stars are changed only with verified `gmail.modify` permission.
- The system never sends a Gmail message automatically.

### Base-resume search contract

- Prompt/config version is `v1.2` in code and forward migration.
- AI generation does not overwrite the current approved profile when a generation attempt fails.
- Manager-added and dismissed terms survive regeneration.
- Manual edits invalidate approval and increment `profile_version`.
- A materially changed resume invalidates the stored content hash and marks the profile stale.
- Approval requires a current resume hash, matching profile version, and 30–48 active terms.
- Managers can disable matching without deleting profile history.
- Structured deterministic rules are stored in `rules_json`; ambiguous free text is marked for human review.
- Profile revisions preserve prior terms, rules, and review state.

### Candidate matcher

- Scheduled at `0 2 * * *` UTC, which is 08:00 Asia/Dhaka, after nightly ingestion has had time to complete.
- Default production mode is `dry_run`.
- Only active candidates and approved, current, non-disabled profiles are eligible.
- Only jobs with a proven posting date inside the last seven days are evaluated.
- Missing/thin descriptions, future/old dates, unproven citizenship/clearance, incompatible sponsorship, explicit experience limits, and explicitly required credentials can hard-reject a match.
- Dismissed terms never contribute positive points; hits remain visible and penalized for audit.
- Each candidate/job pair selects exactly one best base resume deterministically.
- Tier A is 85–100; Tier B is 70–84; lower scores are rejected.
- A maximum of 50 eligible recommendations is kept per candidate, with no generic padding to reach a minimum.
- Runs use a daily idempotency key and a thirty-minute processing lease.
- Decisions and rule outcomes are durable and explainable.
- In `ae_review`, approval creates at most one application for the candidate/job pair, assigns the configured AE, stores the exact base resume, sets `ae_stage = in_ai_pipeline`, queues resume generation, and calls the existing `triggerAiWorkflowForApplication()` service.
- Approval rechecks profile version/hash and seven-day job freshness.

## Database migrations

Deploy in filename order:

- `065_talentos_auth_and_profile_hardening.sql`
- `066_base_resume_keyword_prompt_v1_2.sql`
- `067_candidate_job_matcher.sql`
- `068_candidate_search_profile_rules_and_revisions.sql`

All are additive/forward migrations. Do not roll back by deleting columns or tables. A Worker rollback must remain compatible with the migrated schema.

## Required production configuration

GitHub Actions is the deployment source of truth for these required Cloudflare Worker secrets:

```text
TALENTOS_DATABASE_URL
JWT_SECRET
AI_KEYS_ENCRYPTION_SECRET
CRON_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Required Worker variables:

```text
TALENTOS_BASE_URL=https://talent.skarion.com
STAFF_GOOGLE_AUTH_ENABLED=true
CANDIDATE_GOOGLE_AUTH_ENABLED=true
CANDIDATE_MFA_ENABLED=true
CANDIDATE_GMAIL_ENABLED=true
BASE_RESUME_KEYWORD_AGENT_ENABLED=true
CANDIDATE_JOB_MATCHER_ENABLED=true
CANDIDATE_JOB_MATCHER_MODE=dry_run
```

Before changing matcher mode to `ae_review`, configure:

```text
CANDIDATE_MATCH_DEFAULT_AE_USER_ID=<active application_engineer user UUID>
```

Never put secret values in `wrangler.toml`, source files, tickets, screenshots, or logs.

## Production rollout

1. Review the branch diff and preserve the separate unfinished nightly Job Agent work already present in the worktree.
2. Run typecheck, unit tests, lint, build, and migration validation.
3. Configure the three redirect URIs and production origin in the same Google OAuth web client identified by `GOOGLE_CLIENT_ID`.
4. If the Google OAuth app is in testing mode, add the real pilot candidate Gmail address as a test user. For public use of `gmail.modify`, complete the required Google consent-screen verification process.
5. Add all required GitHub secrets. The deployment now fails closed when auth/encryption/Google secrets are absent.
6. Deploy migrations and Worker code through the deployment workflow.
7. Confirm `/api/health` is 200.
8. Confirm authenticated `/api/admin/integrations/google/readiness` is 200 and reports presence/readiness booleans without secret values.
9. Test staff Google login with a pre-created active staff account.
10. Invite one test candidate, link the matching Google account, log out, and log in again without the invite.
11. Enable MFA for the pilot, save recovery codes securely, and run the MFA acceptance checks below.
12. Connect the pilot Gmail account and run the Gmail acceptance checks below.
13. In AI Control Center, confirm `BaseResume_TO_JobSearchKeyword` shows prompt `v1.2` and the intended Gemini route.
14. Generate missing active-resume profiles; managers review, reduce oversized profiles, and approve them.
15. Keep the matcher in `dry_run` for at least one measured batch and compare its results with AE judgment.
16. Configure the default AE and change to `ae_review` only after the dry-run sample is accepted.

## Acceptance checklist

### Google login

- Staff and candidate start routes redirect to `accounts.google.com`, not HTTP 500.
- The redirect URI exactly matches the correct callback above.
- Invalid, expired, reused, or cookie-mismatched state is rejected.
- An invited candidate links successfully.
- Repeat login works without another invite.
- An unrelated Google account cannot claim a candidate.
- An unknown staff Google account cannot self-provision.

### MFA

- Password login and Google login both stop at MFA when enabled.
- A valid TOTP succeeds.
- A recovery code succeeds once and fails on reuse.
- Five invalid attempts produce a fifteen-minute lock.
- Setup fails safely when encryption is unavailable.
- Logout removes all candidate auth cookies.

### Gmail pilot

- Consent clearly shows `gmail.modify` and the correct TalentOS app/client.
- Connected email/status appear in the portal.
- A known recruiter message is imported once.
- An Indeed/LinkedIn alert, shopping receipt, banking/security code, medical/travel mail, and newsletter are not stored as recruiting communication.
- Relevant messages receive expected labels/stars; unrelated messages are not modified.
- Pause stops synchronization; resume restarts it.
- Retention deletes eligible imported communications but never applications.
- Disconnect revokes the grant when possible, clears local tokens, and marks synchronization stopped/reconnect-required.
- No reply is sent automatically.

### Resume profiles and matching

- AI Control Center and new run audits show prompt `v1.2`.
- Oversized legacy profiles are marked for review, not silently truncated.
- Manual and dismissed terms survive regeneration.
- Editing or changing a resume invalidates approval.
- Disabled/stale/unapproved profiles do not match.
- Old, future, unknown-date, duplicate, hard-rule-failed, and sub-70 jobs never enter AE review.
- The selected base resume and reasons are visible.
- Repeated/concurrent scheduled runs do not duplicate decisions.
- Repeated AE approval does not duplicate applications or workflows.
- The created application stops at human review; no proof, applied timestamp, email, or external submission is created automatically.

## Operational pages

- Google readiness: `/api/admin/integrations/google/readiness` (admin or cron authentication)
- AI Control Center: `/admin/ai`
- Candidate resume search profiles: `/candidates/<candidate-id>/job-search-profiles`
- Candidate match review: `/candidate-job-matches`
- Application queue: `/application-queue`
- Job Agent: `/job-agent`
- Job CEO: `/job-ceo`

## Current validation boundary

Local static and unit validation can prove code paths, contracts, and deterministic behavior. It cannot prove Google Cloud credentials, OAuth consent-screen configuration, a real Gmail grant, Cloudflare secret state, or the live Neon migration result. Those require the controlled production pilot above. Do not mark the full feature “production accepted” until that pilot is recorded with timestamps, test account identity, expected results, and sanitized evidence.
