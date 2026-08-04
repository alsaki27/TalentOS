-- 043: Job source registry + usage tracking, so new bulk/API job-data
-- providers (TheirStack, Coresignal, LinkUp, etc.) can be turned on/off and
-- budget-capped the same way ai_automation_routes does for AI providers,
-- instead of being hardcoded into jobAgentService.ts like the 3 original
-- Apify actors are.
--
-- Nothing reads or writes these tables yet — this migration only creates
-- them. The dispatcher (src/app/api/job-agent/sources/dispatch/route.ts)
-- and admin UI are what actually make them live; until those are wired
-- into scheduled-jobs.yml, this is inert.

CREATE TABLE IF NOT EXISTS job_sources (
  id                      TEXT PRIMARY KEY,        -- e.g. 'theirstack', 'linkup', 'coresignal'
  label                   TEXT NOT NULL,
  adapter_type            TEXT NOT NULL,            -- 'rest_api' | 'bulk_csv' | 'apify_actor'
  is_enabled              BOOLEAN NOT NULL DEFAULT false,
  credentials_ref         TEXT,                     -- key name in your secrets store / env var name
  base_url                TEXT,
  cost_per_record_usd     NUMERIC(10,5),
  monthly_budget_limit_usd NUMERIC(10,2),
  daily_request_limit     INTEGER,
  rate_limit_per_second   NUMERIC(5,2),
  schedule_cron           TEXT,                     -- informational; actual schedule lives in GH Actions
  role_groups             TEXT[] DEFAULT '{}',      -- restrict this source to specific role groups, empty = all
  config                  JSONB DEFAULT '{}',       -- adapter-specific extra settings
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_source_usage (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_id         TEXT NOT NULL REFERENCES job_sources(id),
  run_id            TEXT,                           -- job_agent_runs.id when applicable
  records_fetched   INTEGER NOT NULL DEFAULT 0,
  records_staged    INTEGER NOT NULL DEFAULT 0,      -- after dedup
  estimated_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  outcome           TEXT NOT NULL,                   -- 'success' | 'failure' | 'skipped_budget'
  error_message     TEXT,
  latency_ms        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_source_usage_source_created ON job_source_usage(source_id, created_at DESC);

-- Seed rows for every provider from the research pass — all disabled by
-- default. Enable one at a time from the admin UI (or a plain UPDATE) once
-- its adapter has real credentials wired in.
INSERT INTO job_sources (id, label, adapter_type, is_enabled, cost_per_record_usd, rate_limit_per_second)
VALUES
  ('theirstack',   'TheirStack',        'rest_api', false, NULL, 4),
  ('linkup',       'LinkUp',            'rest_api', false, NULL, NULL),
  ('coresignal',   'Coresignal',        'rest_api', false, NULL, NULL),
  ('fantasticjobs','Fantastic.jobs',    'rest_api', false, NULL, NULL),
  ('jobdataapi',   'jobdataapi.com',    'rest_api', false, NULL, NULL),
  ('techmap',      'Techmap',           'rest_api', false, 0.001, NULL),
  ('brightdata',   'Bright Data',       'rest_api', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
