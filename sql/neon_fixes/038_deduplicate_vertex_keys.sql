-- 038: Deduplicate google vertex proxy keys
--
-- Migration 034 previously used INSERT without checking for existing
-- rows by provider, resulting in multiple google_vertex_proxy rows 
-- if run multiple times. This migration safely consolidates them.

WITH ranked_keys AS (
  SELECT id,
         ROW_NUMBER() OVER(PARTITION BY provider ORDER BY created_at ASC) as rn
  FROM ai_api_keys
  WHERE provider = 'google_vertex_proxy'
),
primary_key AS (
  SELECT id FROM ranked_keys WHERE rn = 1
)
UPDATE ai_automation_routes
SET ai_key_id = (SELECT id FROM primary_key)
WHERE ai_key_id IN (SELECT id FROM ranked_keys WHERE rn > 1);

-- ai_routing_state_routes carries the same
-- "ai_key_id IS NOT NULL OR provider IS NOT NULL" check constraint as
-- ai_automation_routes above, but was added later (075_ai_routing_states.sql)
-- and this migration was never updated to also re-point it. Its FK is
-- ON DELETE SET NULL, so without this UPDATE, deleting a duplicate key
-- below can null out ai_key_id on a row whose provider column is also
-- null, violating the check constraint and failing the whole migration
-- (confirmed failure mode, not hypothetical).
WITH ranked_keys AS (
  SELECT id,
         ROW_NUMBER() OVER(PARTITION BY provider ORDER BY created_at ASC) as rn
  FROM ai_api_keys
  WHERE provider = 'google_vertex_proxy'
),
primary_key AS (
  SELECT id FROM ranked_keys WHERE rn = 1
)
UPDATE ai_routing_state_routes
SET ai_key_id = (SELECT id FROM primary_key)
WHERE ai_key_id IN (SELECT id FROM ranked_keys WHERE rn > 1);

WITH ranked_keys AS (
  SELECT id,
         ROW_NUMBER() OVER(PARTITION BY provider ORDER BY created_at ASC) as rn
  FROM ai_api_keys
  WHERE provider = 'google_vertex_proxy'
)
DELETE FROM ai_api_keys
WHERE id IN (
  SELECT id FROM ranked_keys WHERE rn > 1
);
