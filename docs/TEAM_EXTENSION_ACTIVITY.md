# Team extension access and activity reporting

## Provisioning

An admin issues a key for any active TalentOS team member from **Admin → Extension API Keys**. Assign an owner whenever the key has `extension:job:capture` or `extension:application:assign`; those actions are attributed to that person. For the capture-and-log workflow, grant both scopes. The plaintext key is shown once, and only its hash is stored.

Existing ownerless capture keys continue to work for job capture. Their actions cannot be attributed to a team member until an admin issues an owned key. Inactive members cannot use their owned key for the full capture-and-log workflow.

## Extension workflow

1. Capture a job from its posting page. Search-result bulk capture remains available.
2. For a restricted posting, the server detects citizenship, security-clearance, or export-control language and requires an explicit yes/no confirmation before saving.
3. Optionally request candidate matches. TalentOS evaluates current, approved resume-search profiles with the existing deterministic matcher and score thresholds; this match step does not call an AI model.
4. Choose candidates and one eligible base resume per candidate. The server rechecks each choice, prevents duplicate applications, records the selected resume and fit score, and creates the application in the existing AI-pipeline stage.
5. The existing resume workflow handles tailoring after the application is queued. The extension reports whether the job was added or already existed, each candidate logging result, and the resume-workflow setup state.

## Activity counts

The admin-only **Admin → Team Activity Reports** page supports 1–30 days, daily/weekly/monthly grouping, and filtering by any current or former team member. The totals list shows all team members, including those with zero activity. Times are displayed in Asia/Dhaka.

- **Jobs added**: a new job row created through the extension.
- **Duplicate captures**: an existing job was recognized; it is not counted as newly added.
- **Candidates logged**: a new application was created, including the chosen base resume and match score where available.
- **Resume edits**: a team member changed resume content, formatting, generated text, or title.
- **Reviews completed**: a team member moved an application from `ready_for_review` to `ready_for_application`.
- **Marked as applied**: a team member moved the application to the applied status/stage or recorded a newly verified application. Opening a link does not count.

Each event stores the actor, timestamp, related job/application/candidate, selected base resume when available, and action metadata. The ledger is the source for future scheduled daily and weekly email reports; email delivery is not part of this implementation.

## Deployment prerequisite

Apply `sql/neon_fixes/121_extension_ae_tracking.sql` before deploying the new API routes or admin pages. It adds team-member key ownership/last-used fields and the activity event ledger. Issue owned keys only after the migration has been applied.
