-- Job Agent — Database Migration
-- Creates 3 new tables for the Apify job scraping agent.
-- Run against the Neon database.
-- Does NOT modify any existing tables.

-- ═══════════════════════════════════════════════════
-- 1. job_agent_configs — one row per Apify config
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS job_agent_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,
  apify_token_encrypted TEXT NOT NULL,
  actor_id      TEXT NOT NULL DEFAULT 'khadinakbar~google-jobs-scraper',
  date_posted   TEXT NOT NULL DEFAULT 'today',
  employment_type TEXT NOT NULL DEFAULT 'any',
  proxy_country TEXT NOT NULL DEFAULT 'US',
  max_results   INT NOT NULL DEFAULT 500,
  budget_per_day_usd NUMERIC(6,2) NOT NULL DEFAULT 5.00,
  role_groups   TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════
-- 2. job_agent_runs — one row per scrape execution
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS job_agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id     UUID NOT NULL REFERENCES job_agent_configs(id),
  apify_run_id  TEXT,
  apify_dataset_id TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  raw_count     INT DEFAULT 0,
  deduped_count INT DEFAULT 0,
  imported_count INT DEFAULT 0,
  skipped_count INT DEFAULT 0,
  classified_count INT DEFAULT 0,
  estimated_cost_usd NUMERIC(8,4) DEFAULT 0,
  error         TEXT,
  role_groups_ran TEXT[],
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════
-- 3. job_agent_staged_jobs — staging before main import
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS job_agent_staged_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES job_agent_runs(id),
  job_title         TEXT NOT NULL,
  company_name      TEXT,
  location          TEXT,
  salary_range      TEXT,
  salary_min        NUMERIC,
  salary_max        NUMERIC,
  date_posted       TEXT,
  via_platform      TEXT,
  source_url        TEXT,
  apply_link        TEXT,
  is_remote         BOOLEAN,
  employment_type   TEXT,
  search_query_used TEXT,
  role_group        TEXT,
  role_group_label  TEXT,
  seniority_guess   TEXT,
  tier              TEXT,
  tier_reason       TEXT,
  ai_keywords       TEXT[],
  relevance_score   NUMERIC(4,2),
  is_false_positive BOOLEAN DEFAULT false,
  dedup_hash        TEXT,
  is_duplicate      BOOLEAN DEFAULT false,
  import_status     TEXT DEFAULT 'staged',
  imported_job_id   UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staged_jobs_run_id ON job_agent_staged_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_staged_jobs_dedup ON job_agent_staged_jobs(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_staged_jobs_status ON job_agent_staged_jobs(import_status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_config ON job_agent_runs(config_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_date ON job_agent_runs(started_at DESC);