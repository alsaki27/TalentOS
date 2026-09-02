-- Keep a workflow claim alive through the complete provider fallback chain.
-- 180 seconds was shorter than observed Vertex Pro calls plus retries, which
-- caused live workers to be reclaimed while still running.
ALTER TABLE ai_runtime_config
  ALTER COLUMN workflow_claim_ttl_seconds SET DEFAULT 900;

UPDATE ai_runtime_config
SET workflow_claim_ttl_seconds = 900,
    updated_at = NOW()
WHERE singleton = true
  AND workflow_claim_ttl_seconds < 900;
