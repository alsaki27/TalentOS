-- Clean up all Job Agent run history and scraped job data.
-- Keeps: Apify tokens, keyword groups, configs, and all non-job-agent tables.
-- Run against the Neon database.
BEGIN;

DELETE FROM job_agent_staged_jobs;
DELETE FROM job_agent_runs;

-- Verify we kept the important tables intact
DO $$
DECLARE
  token_count int;
  config_count int;
  kw_count int;
BEGIN
  SELECT COUNT(*) INTO token_count FROM job_agent_apify_tokens;
  SELECT COUNT(*) INTO config_count FROM job_agent_configs;
  SELECT COUNT(*) INTO kw_count FROM job_agent_keyword_groups;
  RAISE NOTICE 'KEPT: % tokens, % configs, % keyword groups', token_count, config_count, kw_count;
END $$;

COMMIT;
