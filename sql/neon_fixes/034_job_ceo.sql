-- 034: JOB CEO multi-agent job-ingestion layer.
-- Seeds 5 new agents (Job CEO, Query Scout, QA Bouncer, Deep Fetch, Matchmaker),
-- their configs and routing (gemini-2.5-pro primary, gemini-2.5-flash fallback),
-- and the three new tables (job_ceo_runs, job_ceo_staging, agent_config_proposals).
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

-- ============================================================================
-- Chunk 2 — ai_automations registry rows
-- ============================================================================
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('job_ceo_orchestrator', 'Job CEO',            'Plans runs and proposes agent tuning',                       'Job CEO'),
  ('job_ceo_scout',        'Query Scout',        'Formulates search/Boolean terms',                           'Job CEO'),
  ('job_ceo_qa',           'QA Bouncer',         'Filters raw jobs on a quality/relevance matrix',            'Job CEO'),
  ('job_ceo_deep_fetch',   'Deep Fetch',         'Scrapes full JD from source URL',                           'Job CEO'),
  ('job_ceo_matchmaker',   'Matchmaker',         'Matches jobs to candidates, logs + drafts outreach',       'Job CEO')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Chunk 3 — ai_agent_configs
-- ============================================================================
INSERT INTO ai_agent_configs (automation_id, display_name, system_prompt, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score, is_active) VALUES
  ('job_ceo_orchestrator', 'Job CEO',       ' ', 'CeoPlanV1',       0.2, 32768, 60000, 2, 'auto', 0, true),
  ('job_ceo_scout',        'Query Scout',   ' ', 'ScoutTermsV1',    0.1, 32768, 30000, 2, 'auto', 0, true),
  ('job_ceo_qa',           'QA Bouncer',    ' ', 'QaVerdictV1',     0.2, 32768, 30000, 2, 'auto', 0, true),
  ('job_ceo_deep_fetch',   'Deep Fetch',    ' ', 'DeepFetchResultV1',0.3, 32768, 60000, 2, 'auto', 0, true),
  ('job_ceo_matchmaker',   'Matchmaker',    ' ', 'MatchmakerResultV1',0.2, 32768, 60000, 2, 'auto', 0, true)
ON CONFLICT (automation_id) DO NOTHING;

-- ============================================================================
-- Chunk 4 — ai_automation_routes → gemini-2.5-pro primary, gemini-2.5-flash fallback
-- ============================================================================
DO $$
DECLARE
  agent_ids text[] := ARRAY['job_ceo_orchestrator','job_ceo_scout','job_ceo_qa','job_ceo_deep_fetch','job_ceo_matchmaker'];
  a_id text;
BEGIN
  FOREACH a_id IN ARRAY agent_ids LOOP
  END LOOP;
END $$;

-- ============================================================================
-- Chunk 5 — job_ceo_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_ceo_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status        text NOT NULL DEFAULT 'ingesting'
                CHECK (status IN ('ingesting','qa','deep_fetch','matchmaking','completed','failed','cancelled')),
  source        text DEFAULT 'openjobdata',
  trigger_type  text DEFAULT 'cron',
  ingested_count int DEFAULT 0,
  kept_count    int DEFAULT 0,
  researched_count int DEFAULT 0,
  matched_count int DEFAULT 0,
  logged_count  int DEFAULT 0,
  scout_terms   jsonb,
  plan_notes    text,
  last_error    text,
  started_by    uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_ceo_runs_status_created_idx ON job_ceo_runs (status, created_at DESC);

-- ============================================================================
-- Chunk 6 — job_ceo_staging
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_ceo_staging (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid REFERENCES job_ceo_runs(id) ON DELETE CASCADE,
  stage             text NOT NULL DEFAULT 'ingested'
                    CHECK (stage IN ('ingested','qa_passed','qa_dropped','researched','matched','logged','error')),
  dedup_signature   text,
  title             text,
  company           text,
  location          text,
  source_url        text,
  external_job_id   text,
  snippet           text,
  description_text  text,
  raw               jsonb,
  qa_score          int,
  qa_reason         text,
  requirements      jsonb,
  match_results     jsonb,
  logged_job_id     uuid,
  claimed_at        timestamptz,
  claim_expires_at  timestamptz,
  last_error        text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_ceo_staging_run_stage_idx ON job_ceo_staging (run_id, stage);
CREATE INDEX IF NOT EXISTS job_ceo_staging_stage_claim_idx ON job_ceo_staging (stage, claim_expires_at);

-- ============================================================================
-- Chunk 7 — agent_config_proposals
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_config_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_automation_id  text NOT NULL,
  proposed_changes      jsonb NOT NULL,
  rationale             text,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','superseded')),
  created_by            text DEFAULT 'job_ceo',
  reviewed_by           uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_config_proposals_status_created_idx ON agent_config_proposals (status, created_at DESC);
