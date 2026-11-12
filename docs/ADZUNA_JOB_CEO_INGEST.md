# Adzuna jobs in Job CEO

The Adzuna adapter is a source collector for the existing Job CEO pipeline. It
does not create a parallel jobs workflow or require a database migration.

## Flow

1. Read current static role titles and custom search keywords from
   `GET /api/job-ceo/effective-keywords`; no keyword list is copied into Python.
2. Search the Adzuna US API with a strict request budget. Terms rotate between
   runs, and Job CEO's seen-ID endpoint prevents repeating known postings.
3. Keep recent US results whose titles match TalentOS's current terms. Resolve
   a direct employer/ATS job page; Adzuna's own redirect is retained only as
   provenance and is not used as the fetch/apply page. A job whose page cannot
   be resolved is sent anyway, with no source_url — it is not dropped here.
4. Send the records through `POST /api/job-ceo/ingest`. The Adzuna excerpt is
   stored as a snippet, not as the job description.
5. The existing Job CEO Deep Fetch reads the direct job page. Adzuna records
   need a full description of at least 1,500 characters to continue to QA and
   candidate matching. Thin, blocked, or missing pages — and pages with no
   resolved link at all — stop at `no_description` (each with its own
   distinct reason) and release the dedup signature so a later run can retry.
   These rows form a standing recovery queue, reviewable and exportable from
   the Job CEO page's "Recovery Queue" view; a staff-recovered description can
   be attached there and re-enters QA directly.
6. QA Bouncer, Matchmaker, and job creation proceed through the ordinary Job
   CEO stages. No employer application is submitted automatically.

## Credentials and request limits

Set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` in ignored `.env.local` for local
execution, or as GitHub Actions secrets for CI. Also set
`JOB_CEO_INGEST_SECRET`; non-dry runs need a valid TalentOS ingest secret.
Credentials are never part of source code or `.env.example` values.

The collector allows at most 35 Adzuna requests per run and spaces requests to
stay under the published 25-per-minute limit. With two scheduled runs, usage
can reach 70 requests/day or 2,170 in a 31-day month, before manual runs or use
of the same API credential elsewhere. One request is one keyword page, not one
workflow run. Adzuna's account-specific weekly/monthly limits still apply, so
check the account quota and budget manual runs too.

The GitHub Actions workflow is scheduled daily at 12:00 AM and 02:00 AM
Bangladesh time (`Asia/Dhaka`) and can also be started manually. Scheduled runs
use separate rotation slots so they search different portions of the keyword
set. GitHub schedule events can still be delayed or dropped under load. Manual
runs default to dry-run. A dry-run still uses Adzuna/search requests and
consumes API quota, but it does not POST to TalentOS or create database rows.

## Local smoke command

From the TalentOS repository root, after setting the environment variables:

```powershell
python scripts/adzuna_job_ceo_ingest.py --role-group A --days 2 --call-budget 1 --dry-run
```

The command reads live keywords, makes one Adzuna search request, and does not
write to the TalentOS database. Omit `--dry-run` only when intentionally
staging jobs in the target TalentOS environment.
