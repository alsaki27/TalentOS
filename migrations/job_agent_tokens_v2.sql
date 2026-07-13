-- Job Agent v2 — Token management + config simplification
-- Run against Neon database.

-- ═══════════════════════════════════════════════════
-- 1. job_agent_apify_tokens — Apify token pool with priority ordering
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS job_agent_apify_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label           TEXT,
  token_encrypted TEXT NOT NULL,
  priority        INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_active_prio ON job_agent_apify_tokens(is_active, priority);

-- ═══════════════════════════════════════════════════
-- 2. Add token_id to job_agent_runs for spend tracking per token
-- ═══════════════════════════════════════════════════
ALTER TABLE job_agent_runs ADD COLUMN IF NOT EXISTS token_id UUID REFERENCES job_agent_apify_tokens(id);

-- ═══════════════════════════════════════════════════
-- 3. Simplify job_agent_configs — drop fields now managed by token pool & hardcoded defaults
-- ═══════════════════════════════════════════════════
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS apify_token_encrypted;
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS actor_id;
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS date_posted;
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS employment_type;
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS proxy_country;
ALTER TABLE job_agent_configs DROP COLUMN IF EXISTS budget_per_day_usd;

-- Seed a default config if none exists (optional, UI auto-creates if needed)
INSERT INTO job_agent_configs (label, max_results, role_groups, is_active)
SELECT 'Default Config', 50, '{}', true
WHERE NOT EXISTS (SELECT 1 FROM job_agent_configs LIMIT 1);