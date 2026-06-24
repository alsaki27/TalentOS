-- Migration: per-category AI provider routing
-- Creates ai_task_category_config to let admins route specific AI tasks to specific
-- providers/keys, without changing the global default chain.

CREATE TABLE IF NOT EXISTS ai_task_category_config (
  category text PRIMARY KEY,
  provider text,                                    -- null = use global default chain
  ai_key_id uuid REFERENCES ai_api_keys(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL
);

-- Add comment explaining the table
COMMENT ON TABLE ai_task_category_config IS 'Per-task-category AI provider/key override. category is one of: resume_studio, chat_assistant, parsing_extraction, content_generation, default. provider=null means fallback to global default chain. ai_key_id set means use that exact DB-managed key.';
