-- 007: AI Control Center — model_override on routes + usage event enrichment.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

-- ai_automation_routes: model override per route
ALTER TABLE ai_automation_routes ADD COLUMN IF NOT EXISTS model_override text;

-- ai_usage_events: route/attempt tracking for fallback visibility
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS route_rank int;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS attempt_number int;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS application_id uuid;
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS error_code text;

-- ai_api_keys: additional health/limit fields
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_test_status text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_test_latency_ms int;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS daily_request_warning int;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS daily_request_limit int;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS monthly_request_limit int;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS monthly_budget_warning_usd numeric(10,5);
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS monthly_budget_limit_usd numeric(10,5);
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS notes text;

-- ai_automation_routes: updated_at if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_automation_routes' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE ai_automation_routes ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Index for route fallback queries
CREATE INDEX IF NOT EXISTS aue_route_idx ON ai_usage_events (automation_id, route_rank, attempt_number);

-- Foreign keys and indexes for usage event enrichment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aue_workflow_fk'
  ) THEN
    ALTER TABLE ai_usage_events
      ADD CONSTRAINT aue_workflow_fk
      FOREIGN KEY (workflow_id) REFERENCES application_ai_workflows(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aue_application_fk'
  ) THEN
    ALTER TABLE ai_usage_events
      ADD CONSTRAINT aue_application_fk
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS aue_workflow_idx ON ai_usage_events (workflow_id);
CREATE INDEX IF NOT EXISTS aue_application_idx ON ai_usage_events (application_id);
