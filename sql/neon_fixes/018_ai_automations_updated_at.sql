-- ai_automations (sql/06_ai_key_manager_v2.sql) never got an updated_at
-- column. PUT /api/admin/ai/agents/[id]/routes writes `updated_at = NOW()`
-- when bumping route_version - confirmed live: "column \"updated_at\" of
-- relation \"ai_automations\" does not exist", breaking every route save.
ALTER TABLE ai_automations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
