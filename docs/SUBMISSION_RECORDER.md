# Candidate submission records

The standalone Chromium extension in `extensions/submission-recorder` records form
questions and answers into TalentOS. It uses the existing extension API-key system,
not a separate Worker, D1 database, Excel workbook, or Microsoft app connection.

## Release

Apply `sql/neon_fixes/148_candidate_submission_records.sql` to the approved TalentOS
database before deploying the app. This additive migration creates one table and
its candidate/time index; it does not change candidate or application statuses.
It is transactional and may be rerun. The manual deployment workflow offers
`apply_candidate_submission_records=true` to run only migration 148; leave
`skip_schema_fixes=true` and all other migration options false. Production migration/deployment requires
approval of that exact target. Existing prerequisites are candidates, profiles,
and extension_api_keys (including owner_user_id from migration 121).

Run `python3 scripts/package-submission-recorder.py` after changing extension files.
The reproducible ZIP and setup instructions are served from `/downloads/` and linked
on `/admin/extension-keys`. Only runtime files enter the ZIP; no credentials/tests.
Installation instructions: `public/downloads/submission-recorder-setup.txt`.

## Access and API

Admins issue a team-owned key with `extension:submission-records:write`; it may be
restricted to one candidate. The key is shown once, stored hashed in TalentOS, and
held in extension-local storage restricted to trusted extension contexts. API calls
use the Authorization bearer header plus X-TalentOS-Client. Page scripts do not get
the key. No credentials are included in the downloadable package.

- GET `/api/extension/v1/submission-records/candidates`: active, available candidate
  IDs/names visible to the key, plus the owning team-member ID.
- POST `/api/extension/v1/submission-records`: `{records:[...]}`, at most 100 entries
  and 1.5 MB. Returns accepted, excluded (sensitive fields), and conflict event IDs.
- GET `/api/candidates/:id/submission-records`: existing staff-session authorization,
  paginated 25 per page, question/answer/source search. Used by the candidate tab.

Revoked keys, missing recorder scope, inactive owners, and out-of-scope candidates
are rejected. Inactive/paused/placed/dropped candidates cannot receive new entries.
The SQL insert rechecks key, owner and candidate access. Staff access to records
matches existing candidate-profile access; recorder keys cannot read history.

## Delivery and data meaning

The extension observes input changes with a 600 ms debounce plus change/blur/submit
events, preserving empty answers. It captures standard inputs, textareas, selects,
checkboxes, radio buttons and common contenteditable fields. Custom widgets and
closed shadow roots may not expose labels/answers; autofill requires a browser event.
All HTTPS websites are enabled by default through the manifest host permission;
the browser still controls installation/update and site-access permissions. Recording
requires a selected candidate. The candidate is locked until Stop recording is used. Selection
and enablement persist across browser restarts; no in-page prompts appear. Toolbar
status and Stop recording remain available. Browsers must be running to capture/sync.

IndexedDB retains pending records before sending. Every entry carries an immutable
candidate ID, event UUID, instance UUID/name, timestamp, question/answer, sanitized
source URL/title, and field/event metadata. Records from multiple computers converge
under the candidate. Switching candidates discards unsent debounce timers so they
cannot be attributed to the next person; already queued entries retain their IDs.

`UNIQUE(instance_id,event_id)` prevents retry duplicates. A canonical payload hash
and original owner distinguish exact retries from collisions; collisions never
overwrite data. Only acknowledged entries leave the queue. Connection changes to a
different owner/server are blocked while pending entries exist. Same-owner key
rotation is supported. No generic third-party endpoints receive recorded data.

Password/file/hidden fields, security codes and common payment/credential fields are
excluded. Query strings and URL fragments are stripped. TalentOS itself is excluded.
Recorded answers may still contain personal candidate information and use existing
TalentOS access/storage controls. A record, including a submit event, does not prove
successful submission and never changes canonical application stage/history.

## Validation and rollback

Focused tests: `node node_modules/vitest/vitest.mjs run src/test/api/submissionRecords.test.ts src/test/api/submissionRecordService.test.ts src/test/api/extensionKeys.test.ts`
and `node --test extensions/submission-recorder/tests/*.test.mjs`.
Use Node 24 and run the repository typecheck/build checks.

Rollback the application release and revoke recorder keys to stop new entries.
Keep the additive table to preserve captured history. Do not drop the table or clear
browser queues as a routine rollback; those actions would delete records.
