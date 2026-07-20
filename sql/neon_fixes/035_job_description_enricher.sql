-- 035: Job Description Enricher agent + jobs-table enrichment tracking.
--
-- Why: job_ceo_deep_fetch (034) only ever touches job_ceo_staging rows, once,
-- during ingest - before a job is logged into `jobs`. Confirmed live: it's
-- gated entirely on stagedJob.source_url being present (OpenJobData rows
-- don't reliably carry a working direct URL depending on the dataset's own
-- column layout), and if the one fetch attempt fails or is skipped, the thin
-- description is permanent - nothing ever revisits a `jobs` row afterward,
-- regardless of source (OpenJobData, Apify, CSV import, manual entry).
--
-- This adds a separate, ongoing background agent that scans the live `jobs`
-- table for rows with a URL but a thin/missing description_text, and retries
-- fetching + extracting the full posting - independent of the ingest
-- pipeline, run on a cron.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('job_ceo_enricher', 'Description Enricher', 'Backfills full job descriptions for jobs with thin/missing text', 'Job CEO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, system_prompt, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score, is_active) VALUES
  ('job_ceo_enricher', 'Description Enricher', ' ', 'DeepFetchResultV1', 0.3, 32768, 60000, 2, 'auto', 0, true)
ON CONFLICT (automation_id) DO NOTHING;

DO $$
BEGIN
END $$;

-- Tracking columns on the live jobs table. attempts is capped in the
-- application query (WHERE description_enrich_attempts < 3) so a job whose
-- source genuinely can't be scraped (dead link, hard bot-block) doesn't get
-- retried forever.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_enrich_attempts int NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_enriched_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_needs_enrichment_idx
  ON jobs (description_enrich_attempts, last_seen_at DESC)
  WHERE is_active = true;
