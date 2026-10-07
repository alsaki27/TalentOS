-- Migration 116: replace retired model overrides on live routing with glm-5.3-flash.
-- Retired models: GLM 5.2, DeepSeek V4 Pro, DeepSeek V4 Flash, GPT-5.6 Luna.
-- Changes model_override only. Keys, providers, ranks, enablement and reasoning_effort are unchanged.
-- Historical rows (usage events, stage runs, workflow snapshots, audit logs) are intentionally not changed.
-- Idempotent: rows already on glm-5.3-flash do not match the WHERE clause.
-- Applied to the live database after a dry run and a row-count check (automation 32 rows, state 97 rows).
BEGIN;

UPDATE ai_automation_routes
SET model_override = 'glm-5.3-flash',
    updated_at = now()
WHERE lower(model_override) IN ('glm-5.2', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.6-luna');

UPDATE ai_routing_state_routes
SET model_override = 'glm-5.3-flash'
WHERE lower(model_override) IN ('glm-5.2', 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5.6-luna');

COMMIT;
