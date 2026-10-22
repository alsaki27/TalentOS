# Team activity email reports

The scheduled GitHub Actions workflow sends a daily team report at 5:00 PM
Eastern Time and an additional weekly report on Sundays at 5:00 PM Eastern
Time. Sunday therefore sends both the daily and weekly report. The daily report
covers midnight through the send time in `America/New_York`; the weekly report
covers the prior seven calendar days ending at the send time.

Reports include only active profiles whose role is `application_engineer` or
`manager`. They count jobs added, candidates logged, reviews completed, and
applications marked applied. Duplicate captures and resume edit events are
excluded. The report query is read-only and does not create email log or report
rows in the database. No database migration is required.

## Deployment configuration

The current test recipient is configured as a Cloudflare Worker variable in
`wrangler.toml`:

```text
TEAM_ACTIVITY_REPORT_RECIPIENTS = "shohanhyder@gmail.com"
```

Multiple recipients can be separated by commas or semicolons. Update this
deployment variable to add or remove recipients; the report recipient list is
not stored in TalentOS or the database. The current address will receive the
scheduled daily report and the additional weekly report on Sundays until the
variable is changed.

The route uses the existing configured email sender: Microsoft Graph when all
`MS_GRAPH_*` settings are present, otherwise Resend when both `RESEND_API_KEY`
and `EMAIL_FROM` are configured. It does not use the mock/log-only mail path,
and it will fail clearly if no real sender is configured.

GitHub Actions must have its existing `CRON_SECRET` secret and the
`TALENTOS_BASE_URL` repository variable (optional; defaults to the live TalentOS
URL). GitHub schedules run in UTC, so the workflow has a 21:00 and 22:00 UTC
trigger and checks `America/New_York` at runtime. This handles Eastern daylight
and standard time without changing the 5:00 PM local schedule.

No email is sent by editing or building this code. Sending starts only after
the workflow and endpoint are deployed and the runtime sender/recipient
settings are present.
