# Team activity email reports

The Cloudflare Worker Cron handler sends the daily report every day at 5:00 PM
Eastern Time and the weekly report every Sunday at 6:00 PM Eastern Time. The
handler evaluates Cloudflare's scheduled instant in `America/New_York`, so the
schedule follows Eastern daylight and standard time automatically. On Sundays,
the daily and weekly reports are sent at their separate scheduled times.

The daily report covers midnight through the send time in `America/New_York`;
the weekly report covers the prior seven calendar days ending at the send time.
Reports include only active profiles whose role is `application_engineer` or
`manager`. They count jobs added, candidates logged, reviews completed, and
applications marked applied. Duplicate captures and resume edit events are
excluded. The report query is read-only and does not create email log or report
rows in the database. No database migration is required.

## Deployment configuration

Report recipients are configured as a Cloudflare Worker variable in
`wrangler.toml`:

```text
TEAM_ACTIVITY_REPORT_RECIPIENTS = "info@skarion.com,shohanhyder@gmail.com"
```

Multiple recipients can be separated by commas or semicolons. Change this
deployment variable to add or remove recipients; recipient settings are not
stored in TalentOS or the database.

The route uses the existing configured email sender: Microsoft Graph when all
`MS_GRAPH_*` settings are present, otherwise Resend when both `RESEND_API_KEY`
and `EMAIL_FROM` are configured. It does not use the mock/log-only mail path,
and it fails clearly if no real sender is configured.

The Worker's existing `CRON_SECRET` is used for server-to-server calls. The
GitHub Actions workflow named **Team activity email reports** has a manual
`workflow_dispatch` option for intentionally sending a daily or weekly report
to all currently configured recipients. The recurring schedule is owned by the
Cloudflare Cron handler, which runs each minute alongside the existing AI
pipeline dispatcher and only invokes a report at its configured Eastern time.

The automated schedule targets 5:00 PM and Sunday 6:00 PM Eastern. Cron starts
the send at those scheduled instants; final inbox arrival can still vary with
the configured email provider.
