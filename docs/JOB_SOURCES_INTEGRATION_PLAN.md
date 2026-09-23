# Job Sources Integration Plan

Adds 7 new job-data providers (TheirStack, LinkUp, Coresignal, Fantastic.jobs,
jobdataapi.com, Techmap, Bright Data) alongside the existing openjobdata.com
batch import and the 3 Apify actors (Indeed/Google/LinkedIn), all feeding the
same `job_agent_staged_jobs` → dedup → AI-classify → approve → import pipeline.

**Status of this document:** scaffolding for the infra layer is already
written and committed (see "What's already done" below). Nothing is enabled
or wired into cron yet — every new `job_sources` row seeds `is_enabled =
false`, so none of this changes production behavior until you work through
the phases below.

---

## What's already done

| File | Purpose |
|---|---|
| `sql/neon_fixes/043_job_sources.sql` | `job_sources` (config/registry) + `job_source_usage` (cost/volume tracking) tables, seeded with all 7 providers disabled |
| `src/lib/jobSources/types.ts` | `NormalizedJob` (canonical shape) + `JobSourceAdapter` interface |
| `src/lib/jobSources/registry.ts` | Maps a `job_sources.id` to its adapter implementation |
| `src/lib/jobSources/adapters/theirstack.ts` | **Real, working adapter** — POST `/v1/jobs/search`, Bearer auth, confirmed against current public docs |
| `src/lib/jobSources/adapters/linkup.ts` | Stub — LinkUp is enterprise/contract-based, no public API to build against yet |
| `src/lib/jobSources/adapters/{coresignal,fantasticJobs,jobdataapi,techmap,brightdata}.ts` | Stubs with vendor-specific notes on what to confirm before implementing |
| `src/server/repositories/jobSourceRepository.ts` | Config CRUD + budget-limit checks (mirrors `routing.ts`'s `checkKeyLimits` pattern) + usage recording/rollup |
| `src/app/api/job-agent/sources/dispatch/route.ts` | Generic dispatcher — loops enabled sources, checks budget, fetches, dedupes (reusing `dedupHash`/`getDedupHashes`/`getSourceUrlHashes`/fuzzy match against the live `jobs` table), classifies via the existing AI classifier, stages |
| `src/middleware.ts` | Widened the existing CRON_SECRET allowlist to also cover `/api/job-agent/sources/dispatch` |

Everything above compiles against the real interfaces already in the repo
(`JobAgentStagedJobRow`, `getDedupHashes`, `classifyJob`, etc.) — this isn't
throwaway pseudocode, it's meant to be built on directly.

---

## Phase 1 — Run the migration, verify the scaffold compiles

1. Apply `sql/neon_fixes/043_job_sources.sql` (same mechanism as every other file in that folder — the deploy pipeline runs them automatically, or apply by hand against your dev DB first).
2. `npm run build` / `npm run typecheck` to confirm the new files compile cleanly against the current codebase — they were written against the real types but haven't been run through the project's own build yet.
3. Sanity check: `SELECT * FROM job_sources;` should show 7 rows, all `is_enabled = false`.

## Phase 2 — Pilot: TheirStack (real adapter, ready to test)

1. Get a TheirStack API key (Settings → API Keys in their dashboard).
2. Set an env var — e.g. `THEIRSTACK_API_KEY` — in your local `.env` and eventually as a GitHub secret + `wrangler secret put`.
3. `UPDATE job_sources SET is_enabled = true, credentials_ref = 'THEIRSTACK_API_KEY', role_groups = ARRAY['A'] WHERE id = 'theirstack';` (start with one role group, e.g. `'A'` = OSP/Fiber, to keep the pilot small).
4. Call the dispatcher manually first: `POST /api/job-agent/sources/dispatch` with `Authorization: Bearer $CRON_SECRET`.
5. Check `job_agent_runs` for the new run (its `actor_source` will be `'theirstack'`) and `job_agent_staged_jobs` for results — verify against the existing job-agent review UI (`/job-agent`), same as any Apify run.
6. **Before trusting the numbers**: `theirStackAdapter.estimatedCostUsd` currently returns `0` — TheirStack bills in credits, not direct USD, so you need to look up your plan's $/credit rate and either hardcode it in the adapter or (better) set `job_sources.cost_per_record_usd` and compute cost in the dispatcher instead of the adapter.

## Phase 3 — Pilot: LinkUp (needs a vendor conversation first)

LinkUp doesn't have a public self-serve API — this is the one phase that starts outside the codebase:

1. Contact LinkUp / getlinkup sales, confirm you're talking to the labor-market-data company (there's an unrelated "linkupapi.com" LinkedIn-automation product with a confusingly similar name — verify domain/company before signing anything).
2. Get: real base URL, auth scheme, and whether delivery is a live API or scheduled bulk file drop (SFTP/CSV). This determines whether `linkup.ts`'s `adapter_type` should stay `'rest_api'` or change to `'bulk_csv'`.
3. If it's file-based, model the adapter after `scripts/openjobdata_ingest.py` + `/api/job-agent/openjobdata-ingest/route.ts` instead of the `fetchJobs()` HTTP pattern — that's the existing precedent for a pull/file source in this codebase.
4. Replace the stub's `throw new Error(...)` with the real implementation once you have real docs.

## Phase 4 — Compare the pilot, decide what's next

Once both pilot sources have run for 1-2 weeks:

```sql
SELECT * FROM job_source_usage_summary; -- or run getSourceUsageSummary() from jobSourceRepository.ts
```

Cross-reference against QA Bouncer pass-rate per source:
```sql
SELECT via_platform,
       COUNT(*) FILTER (WHERE tier IN ('best','medium')) * 100.0 / COUNT(*) AS pass_rate_pct,
       COUNT(*) AS total
FROM job_agent_staged_jobs
WHERE via_platform IN ('theirstack', 'linkup')
GROUP BY via_platform;
```

Use this to decide which of the remaining 5 stub adapters (Coresignal,
Fantastic.jobs, jobdataapi.com, Techmap, Bright Data) are actually worth
building — don't implement all 5 speculatively.

## Phase 5 — Remaining adapters (as justified by Phase 4)

Each stub file (`coresignal.ts`, `fantasticJobs.ts`, `jobdataapi.ts`,
`techmap.ts`, `brightdata.ts`) has vendor-specific notes at the top of the
file about what to confirm before implementing (signup flow, pricing model,
delivery mechanism, ToS considerations for Bright Data specifically). Follow
the same pattern as `theirstack.ts`: real endpoint, real auth, a `normalize()`
function mapping the vendor's response into `NormalizedJob`.

## Phase 6 — Cron wiring

Once at least one real source is proven out, add **one** new entry to
`.github/workflows/scheduled-jobs.yml` (not one per source):

```yaml
job-sources-dispatch:
  if: >
    (github.event_name == 'schedule' &&
     github.event.schedule == '*/30 * * * *') ||
    github.event.inputs.job == 'job-sources-dispatch' ||
    github.event.inputs.job == 'run-all'
  runs-on: ubuntu-latest
  name: Job sources dispatch
  steps:
    - name: Call job sources dispatch
      run: |
        HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
          -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
          "${{ env.TALENTOS_BASE_URL }}/api/job-agent/sources/dispatch")
        if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 400 ]; then
          echo "::error::Scheduled job failed with HTTP $HTTP_CODE"
          exit 1
        fi
```
Also add `job-sources-dispatch` to the `workflow_dispatch.inputs.job.options` list at the top of that file, same as every other job there.

## Phase 7 — Admin UI (optional, do this once you're past the pilot)

Extend the existing job-agent admin pages (`/job-agent` area) with a simple
source management panel backed by `jobSourceRepository.ts`'s existing
functions — `listJobSources`, `setJobSourceEnabled`, `updateJobSourceBudget`.
Nothing in the repository layer requires new endpoints beyond simple CRUD
routes wrapping those functions; this phase is UI-only.

---

## Guardrails already built in (don't remove these when extending)

- **Budget caps enforced before spend, not after** — `checkSourceBudget()` runs before every dispatch call, same fail-closed pattern as the AI key manager.
- **4-layer dedup reused, not reimplemented** — in-batch hash, cross-run hash (30-day window), cross-source URL fingerprint, fuzzy match against the live `jobs` table. Adding sources increases duplicate volume; this is why layer 3 (URL fingerprint) and layer 4 (fuzzy) both exist — don't skip either when extending.
- **`via_platform` carries the source name through to the final `jobs.source` field** (via `jobAgentImporter.ts`'s existing logic) — this is what makes the Phase 4 per-source QA pass-rate query possible. Don't overwrite or normalize this value away in a new adapter.

## Open questions for you to resolve before Phase 6

1. TheirStack's actual $/credit rate on your plan (needed to make `estimated_cost_usd` real instead of `0`).
2. Whether LinkUp is even worth pursuing given it requires a sales contract — the original recommendation was to pilot it specifically because it's structurally different (direct-from-employer) from every aggregator you already have, but that's a judgment call on your end once you know their pricing.
3. Legal/product sign-off on Bright Data specifically, before that adapter is ever implemented (see the note in `brightdata.ts`).
