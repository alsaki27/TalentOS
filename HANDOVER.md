# TalentOS / Skarion Handover

**Date:** 2026-08-07
**Backend:** `alsaki27/TalentOS`
**Extension:** `skarion-dev/talentos-copilot-extension`
**Backend branch:** `neon-cloudflare-migration`
**Live backend:** https://skarion-talent-os.skarion-talentos.workers.dev

This is the takeover guide for the TalentOS application workflow, Candidate Portal, Gmail intelligence, AE work queue, and Chrome Copilot extension.

## 1. Product goal

TalentOS connects three workflows:

1. A candidate signs in, secures the account with Google Authenticator, and optionally connects Gmail.
2. Gmail is reviewed for recruiting activity only. AI ignores personal mail, job-alert noise, and marketing.
3. AEs receive actionable tasks, can review source email, draft a reply, manually add missing applications, update stages, and resolve work with an audit note.

The Chrome extension lets an AE open a real ATS application, select the correct candidate, analyze the form, fill it with the correct resume/context, review changes, save corrections, and attach generated documents.

## 2. Repository state

Latest backend commit: `67735be` — “Flag and capture untracked candidate applications”
Remote: `origin/neon-cloudflare-migration`

Recent backend milestones:

| Commit | Result |
|---|---|
| `6a834fe` | Modernized responsive jobs workspace |
| `bfe41aa` | Added Copilot action to application queue |
| `162d24f` | Hardened malformed Copilot JSON handling |
| `6ecf539` | Added tailored resume PDF fallback |
| `0f7fbfe` | Added candidate email work queue and enrollment-date backfill |
| `1b917a3` | Added MFA, Gmail labels/stars, interview extraction, and fixtures |
| `975afb1` | Hardened MFA encryption and personal-email safeguards |
| `9791b57` | Added drafts, retention, privacy, SLAs, conflicts, and workflow events |
| `dde838a` | Synced applied status from Copilot extension |
| `67735be` | Added untracked-application detection and AE manual application creation |

Recent extension milestones:

| Commit | Result |
|---|---|
| `383b1ac` | Initial TalentOS Application Copilot |
| `34b0ac7` | Linked Copilot to application records |
| `49c80f7` | Added ATS browser fixture test suite |
| `bfac18f` | Fixed linked application handoff |
| `505939b` | Added tailored resume download |
| `c6d4579` | Added resume fallback handling |
| `543a9fd` | Added form submission status sync |

## 3. Candidate authentication and Gmail flow

### Candidate authentication

1. Candidate signs in with password or Google OAuth.
2. If MFA is enabled, TalentOS issues a short-lived pending-MFA cookie instead of a full session.
3. Candidate enters a six-digit TOTP code.
4. Recovery codes are hashed and one-time-use.
5. Five invalid attempts cause a temporary lockout.

Files:

- `src/server/auth/candidateAuth.ts`
- `src/server/auth/totp.ts`
- `src/app/api/portal/auth/mfa/route.ts`
- `src/app/api/portal/auth/mfa/verify/route.ts`
- `src/app/portal/login/page.tsx`
- `src/app/portal/page.tsx`

### Gmail onboarding

1. Candidate enters the Skarion enrollment date.
2. Candidate consents to Gmail access.
3. OAuth requests `gmail.modify`, required for labels and stars.
4. The callback records `email_consent_at`.
5. Initial sync searches after the enrollment date; later syncs use Gmail history IDs.
6. Paused candidates are skipped by the sync worker.
7. Retention cleanup removes imported email/drafts past the candidate's retention period.

Files:

- `src/lib/integrations/googleGmail.ts`
- `src/lib/integrations/gmailApi.ts`
- `src/app/api/integrations/gmail/callback/route.ts`
- `src/server/services/gmailSyncService.ts`
- `src/server/repositories/gmailIntegrationRepository.ts`

Existing Gmail users must reconnect after the `gmail.modify` scope change. A read-only token cannot write labels or stars.

## 4. Email intelligence and AE workflow

Relevant recruiting messages can produce:

- Internal application timeline notes.
- AE action items.
- Gmail labels and stars.
- High-confidence stage updates for approved categories.
- Interview extraction and schedule creation.
- Calendar-conflict tasks.
- Untracked-application tasks.

The system suppresses obvious personal messages before AI when known sender domains match commerce/delivery/travel/banking patterns plus order/receipt/delivery subjects. The prompt also excludes personal receipts, DoorDash/Uber Eats, shopping, shipping, rideshare, banking, medical, travel, social, account-security mail, Indeed/LinkedIn alerts, newsletters, and marketing.

### Untracked applications

Application confirmations such as “Application received,” “Thank you for applying,” or “Successfully applied” are detected. If no matching TalentOS application exists, the system creates:

`Application found outside TalentOS`

The AE enters company, job title, and optional application URL. TalentOS creates or reuses the job, creates the application with source type `email_confirmation`, links the task, and records an audit event.

Files:

- `src/lib/ai/emailTriage.ts`
- `src/server/services/gmailSyncService.ts`
- `src/app/api/action-items/[id]/add-application/route.ts`
- `src/app/candidate-dashboard/page.tsx`

### AE dashboard

The Candidate Application Dashboard shows:

- Candidate, job, company, and source email.
- Priority, due time, and escalation state.
- Open-email link.
- Draft-reply action.
- Take-over action.
- Resolve action requiring an AE note.
- Add-application action for untracked confirmations.

Same-thread outbound mail can automatically resolve reply tasks. Manual AE resolution is audited.

### Reply drafts

`email_reply_draft` creates a reviewable draft only. It never sends email automatically.

Files:

- `src/lib/ai/emailReplyDraft.ts`
- `src/app/api/action-items/[id]/draft-reply/route.ts`

## 5. AI Control Center

New candidate-workflow agents:

| Automation ID | Purpose | Route |
|---|---|---|
| `email_triage` | Relevance, category, match, reply need | Gemini 2.5 Flash Lite |
| `email_interview_extraction` | Interview logistics | Gemini 2.5 Flash Lite |
| `email_action_enrichment` | Reserved enrichment/label agent | Gemini 2.5 Flash Lite |
| `email_reply_draft` | Reviewable recruiter reply | Gemini 2.5 Flash Lite |

New AI code must use `callWithUsageTracking`, have Control Center config/routes, strict JSON parsing, and human fallback.

The pre-existing `copilot_cover_letter` route was configured for Gemini 2.5 Pro before this work. Do not change that route without evaluating quality.

## 6. Database migrations

Apply these after the earlier email/Copilot migrations:

| Migration | Purpose |
|---|---|
| `sql/neon_fixes/055_candidate_email_workflow.sql` | Enrollment date, email notes, task resolution, dedupe |
| `sql/neon_fixes/056_candidate_mfa_and_email_actions.sql` | MFA, Gmail write fields, interview agents |
| `sql/neon_fixes/057_candidate_workflow_controls.sql` | Consent, pause/retention, SLAs, drafts, workflow events |
| `sql/neon_fixes/058_email_confirmation_application_source.sql` | Allows `email_confirmation` application source |

Required production configuration:

- `DATABASE_URL` or `NEON_DATABASE_URL`
- `JWT_SECRET`
- `AI_KEYS_ENCRYPTION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_OAUTH_REDIRECT_URI`
- `TALENTOS_BASE_URL`
- `CRON_SECRET`

MFA setup returns a controlled error if `AI_KEYS_ENCRYPTION_SECRET` is missing; it must not store an unencrypted TOTP secret.

## 7. Manual test plan

### Authentication and MFA

1. Sign in without MFA and confirm `/portal` loads.
2. Enable Google Authenticator from Account Security.
3. Scan the URI/secret and confirm with a six-digit code.
4. Sign out and confirm the next login requires MFA.
5. Use a recovery code; confirm it works once only.
6. Enter five invalid codes; confirm temporary lockout.
7. Test password and Google OAuth login with MFA enabled.
8. Remove encryption configuration in staging; confirm MFA setup fails safely.

### Gmail consent/privacy

1. Connect a new Gmail account and confirm Google shows modify access.
2. Confirm `email_consent_at` is populated.
3. Confirm initial sync honors the enrollment date.
4. Pause sync, run Gmail cron, and confirm the account is skipped.
5. Resume sync and confirm it runs again.
6. Change retention to 90 days and run cleanup.
7. Delete imported history; confirm email records/drafts are deleted while applications remain.
8. Revoke Gmail access and confirm the account enters reconnect/error state.

### Personal-email suppression

Use controlled messages for:

- DoorDash order receipt.
- Amazon shipping notice.
- Uber trip receipt.
- Bank payment alert.
- Medical appointment.
- LinkedIn job alert.
- Indeed “great fit” recommendation.

Expected: no AE task, application note, stage change, or recruiting Gmail label/star.

### Recruiting workflow

Test each with and without a matching TalentOS application:

- Greenhouse confirmation.
- Lever recruiter reply.
- Workday status update.
- Ashby scheduling email.
- Zoho invitation.
- Rejection.
- Offer.
- Reschedule/cancellation.
- Forwarded recruiter email.
- Missing date/timezone.
- Application confirmation with no TalentOS match.

Expected:

- Correct messages attach to the correct application.
- Unmatched confirmations create `untracked_application`.
- Interview messages are starred/labeled and create a task.
- Missing logistics remain human-reviewable.
- Duplicate sync does not create duplicate tasks/notes/schedules.

### AE queue

1. Open Candidate Application Dashboard.
2. Confirm candidate/job/email details.
3. Generate and edit a reply draft; confirm nothing is sent.
4. Take over with a note.
5. Try resolving without a note; confirm rejection.
6. Resolve with a note; confirm task closure and audit event.
7. Add a missing application; confirm job/application creation.
8. Leave a task overdue, run Gmail cron, and confirm urgent escalation.
9. Create overlapping interviews and confirm a calendar-conflict task.

### Copilot extension

1. Load the unpacked extension in Chrome.
2. Configure the TalentOS API key.
3. Test Greenhouse, Lever, Workday, Ashby, and Zoho forms.
4. Confirm candidate/application handoff.
5. Analyze, inspect, fill, manually correct, Save & Learn.
6. Test malformed/aborted AI response recovery.
7. Test tailored resume and cover-letter attachment fallback.
8. Submit a form and confirm applied-status sync.

## 8. Improvements still recommended

### High priority

1. Install Node and run `npm run typecheck`, `npm test`, `npm run lint`, and Playwright.
2. Apply migrations in staging Neon before production.
3. Add mocked Gmail API tests for list/get/modify/labels.
4. Integrate Google Calendar for real attendee responses, cancellations, reminders, and conflicts. Current conflict detection uses TalentOS schedules only.
5. Add a Gmail reconnect banner for old `gmail.readonly` scopes.
6. Wire `email_action_enrichment` into the sync path or remove it until used; it is currently registered for future use.
7. Add deterministic classification tests for personal receipts and application confirmations.

### Medium priority

1. Add AE assignment and configurable SLA/escalation notifications.
2. Add recruiter contact extraction and deduplication.
3. Add draft approval/save/send endpoints, with explicit AE confirmation before sending.
4. Add “wrong application match” correction/rematch.
5. Add candidate-visible consent/audit history.
6. Add GDPR-style export/delete tooling and deletion reports.
7. Add a richer workflow-event timeline UI.

Safety rules:

- Never auto-send AI email.
- Never auto-change stages from ambiguous mail.
- Never expose internal AI notes unless explicitly marked candidate-visible.
- Never treat generic job alerts as applications.
- Never store Gmail tokens or MFA secrets without encryption.

## 9. Developer takeover

Backend:

~~~powershell
cd C:\path\to\TalentOS
git checkout neon-cloudflare-migration
git pull origin neon-cloudflare-migration
npm install
npm run typecheck
npm test
npm run lint
npm run build
~~~

Extension:

~~~powershell
cd C:\path\to\talentos-copilot-extension
git checkout main
git pull origin main
npm install
~~~

Load the extension through `chrome://extensions` with Developer Mode enabled. Configure the TalentOS API base URL and extension API key.

Debugging map:

- Gmail sync: `src/server/services/gmailSyncService.ts`
- Gmail OAuth/tokens: `src/lib/integrations/googleGmail.ts`, `src/server/repositories/gmailIntegrationRepository.ts`
- Email triage: `src/lib/ai/emailTriage.ts`
- Interview extraction: `src/lib/ai/emailInterviewExtraction.ts`
- Reply drafts: `src/lib/ai/emailReplyDraft.ts`
- AE queue: `src/app/candidate-dashboard/page.tsx`, `src/app/api/candidate-dashboard/route.ts`
- Candidate MFA: `src/server/auth/candidateAuth.ts`, `src/server/auth/totp.ts`, `src/app/api/portal/auth/mfa/*`
- Copilot: `src/app/api/extension/v1/copilot/*` and the extension repository
- AI routing: `src/lib/ai/routing.ts`
- AI Control Center: `src/app/admin/ai`, `src/app/api/admin/ai/*`

Change discipline:

1. Add migrations for schema changes.
2. Register every AI automation in the Control Center.
3. Use `callWithUsageTracking` only.
4. Add strict parsing and human fallback.
5. Add audit events and fixtures.
6. Run typecheck/tests/build.
7. Commit and push when coding is complete.

## 10. Validation status

## 11. Gmail Backfill Runner and Spare-PC Operations

The spare Windows machine is the preferred high-throughput worker for Gmail backfills and future mailbox automation. It is reachable over SSH at `192.168.1.193` as user `saki-`, with the repository at `C:\JobSearch-Support-Talentos`.

Runtime services:

- `JobSearchApp`: support app on port `3100`.
- `JobSearchNightly`: nightly cycle at 00:00.
- `gateway/main.py`: LLM gateway on port `8787`.
- Cloudflare tunnel: exposes the support service for TalentOS integration.

TalentOS remains the source of truth for Gmail OAuth tokens, candidate ownership, imported messages, triage, application matching, and stage changes. The spare PC should invoke production sync; it must not write directly to Neon or run a second Gmail importer.

Production sync endpoint:

```text
GET https://talent.skarion.com/api/cron/gmail-sync
Authorization: Bearer <CRON_SECRET>
```

The runner must call the endpoint serially, continue while `gmail_backfill_complete=false`, stop on OAuth/token/database errors, and log only status, elapsed time, account scope, and count summaries—not tokens or message bodies. After backfill, it should continue at a low-frequency incremental-sync interval.

Required production variables are separate from Google login credentials:

```text
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
CRON_SECRET
TALENTOS_BASE_URL=https://talent.skarion.com
```

### Planned Gmail agents

> AI agents are not part of the current Gmail sync dependency. Gmail ingestion,
> pagination, deduplication, token refresh, suppression, and storage must work
> deterministically before any AI classification or automation is enabled.

### Current code-first Gmail sync

The current Gmail system is a code-driven mailbox importer. Its responsibilities
are intentionally separate from future AI work:

- OAuth consent and refresh-token storage use `GMAIL_CLIENT_ID` and
  `GMAIL_CLIENT_SECRET`, separate from Google login credentials.
- `src/lib/integrations/gmailApi.ts` owns Gmail REST calls, profile lookup,
  message listing, history listing, message retrieval, labels, and stars.
- `src/server/services/gmailSyncService.ts` owns account selection, token
  refresh, incremental history sync, paginated backfill, idempotent storage,
  and sync error handling.
- `src/server/repositories/gmailIntegrationRepository.ts` owns encrypted token
  persistence, account state, history IDs, backfill page tokens, and completion
  state.
- `email_communications` is the durable imported-message store. Gmail message
  IDs and thread IDs are the deduplication keys.
- `/api/cron/gmail-sync` is the production worker entry point.
- `/api/candidate-dashboard/force-sync` is the authenticated manual recovery
  entry point.
- `.github/workflows/scheduled-jobs.yml` invokes the production endpoint. Its
  `TALENTOS_BASE_URL` must remain `https://talent.skarion.com`.

### Sync state contract

Every candidate Gmail account must have an observable state:

```text
active + gmail_backfill_complete=false  = backfill still running
active + gmail_backfill_complete=true   = incremental sync eligible
error                                    = sync paused until recovery
revoked                                  = OAuth permission removed
```

The sync worker must never silently skip an account. A failed account needs a
visible `sync_error`, an updated timestamp, and a retry path. Reconnecting Gmail
must reset the history ID and backfill cursor only when a new OAuth grant is
actually received.

### Backfill and incremental rules

1. Process one account at a time; never run concurrent syncs for the same
   candidate.
2. During backfill, consume `gmail_backfill_page_token` until Gmail returns no
   next page token, then set `gmail_backfill_complete=true`.
3. Store each message idempotently by `integration_account_id + gmail_message_id`.
4. Preserve sent mail, received mail, thread IDs, timestamps, labels, unread,
   important, and starred flags.
5. After backfill, persist Gmail `historyId` and use history-based incremental
   sync. If Gmail reports an expired history ID, restart a bounded backfill
   rather than losing messages.
6. Retry transient Gmail 429/5xx failures with bounded backoff. Do not retry
   invalid OAuth credentials indefinitely.
7. Never log access tokens, refresh tokens, full email bodies, or authorization
   headers.

### Candidate onboarding checklist

For every candidate mailbox:

1. Candidate completes Gmail consent from the candidate portal.
2. Verify the account belongs to the intended candidate email.
3. Verify the granted scope includes `gmail.modify` when labels/stars are
   required.
4. Confirm the account is `active` and `email_sync_paused=false`.
5. Trigger the first backfill and record the starting count.
6. Continue until `gmail_backfill_complete=true`.
7. Confirm a later test email appears through incremental sync.
8. Confirm duplicate sync runs do not increase the same Gmail message ID count.

### Current operational recovery

If a mailbox is stuck:

```text
1. Inspect integration_accounts.status, sync_error, last_synced_at,
   gmail_history_id, gmail_backfill_page_token, and gmail_backfill_complete.
2. If status=error because of deployment configuration, fix production secrets
   first; do not delete the candidate's email history.
3. Set the account active only after the root cause is fixed.
4. Trigger /api/cron/gmail-sync serially until the cursor advances.
5. Verify email_communications count, max(ingested_at), and newest sent_at.
```

The account must not be reset to a blank state merely because one sync request
failed. Existing imported messages are retained and deduplicated on retry.

### Future Gmail work, still code-first

Before introducing AI agents, complete these deterministic improvements:

- Add a per-account sync-run table with start/end time, page count, fetched,
  inserted, duplicate, skipped, and error counts.
- Add an admin Gmail health page showing every candidate account and its exact
  cursor/backfill state.
- Add a safe “Continue backfill” button for managers/admins.
- Add a bounded worker loop on the spare PC or a dedicated scheduled runner;
  keep one concurrency lock per Gmail account.
- Add retention-aware cleanup that respects each candidate's privacy setting.
- Add fixtures for expired history IDs, revoked consent, rate limits, duplicate
  messages, malformed MIME parts, pagination interruption, and empty inboxes.
- Add alerts when an active account has not synced for 30 minutes or remains in
  backfill for an abnormal duration.
- Add a reconciliation command comparing Gmail message IDs against
  `email_communications` without importing personal content.

Only after these code paths are reliable should future AI components be allowed
to classify recruiting relevance, match applications, extract interviews, or
create AE tasks. AI must consume stored messages; it must never be responsible
for determining whether Gmail synchronization itself succeeded.

Register every new agent in the AI Control Center and use the approved low-cost model route unless a human explicitly selects a higher-cost review run:

- `GmailMessageClassifier`: deterministic suppression first, then recruiting relevance.
- `GmailApplicationMatcher`: match messages to candidate/application/job.
- `GmailStageUpdater`: propose or apply screening, interview, offer, rejected, and follow-up stages with evidence.
- `GmailInterviewExtractor`: extract dates, timezone, links, recruiter, location, and deadlines.
- `GmailAEActionPlanner`: create one deduplicated AE task with due date and evidence.
- `GmailReplyDraftAgent`: draft replies; sending remains human-approved.

Personal receipts, food delivery, shopping, banking, medical, travel, security alerts, job alerts, and generic job-board recommendations must be suppressed before AI matching. Suppressed mail must not create applications, notes, stage changes, or AE tasks.

### Safe deployment warning

Do not run `deploy.ps1` while unrelated Python processes are active. Its restart step terminates every `python.exe` process on the spare PC. Inspect Python processes and scheduled tasks first and deploy only during a maintenance window.

### Validation checklist

- Confirm the Cloudflare tunnel resolves to the intended spare-PC service.
- Confirm schedulers target `https://talent.skarion.com`, not the old `workers.dev` hostname.
- Confirm the Gmail account is active, error-free, and has `gmail.modify` scope.
- Confirm pagination advances and eventually sets `gmail_backfill_complete=true`.
- Confirm new mail is imported without duplicate Gmail message IDs.
- Confirm suppressed mail creates no applications or AE tasks.
- Confirm recruiter/interview mail is stored, matched to the correct application, and visible in the Gmail log.

The latest source changes passed `git diff --check` before push. Runtime typecheck, unit tests, E2E tests, Gmail calls, and Neon migration execution still need to run in an environment with Node, dependencies, secrets, and database access. That is the receiving developer’s first action after pulling the branch.
