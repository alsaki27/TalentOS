-- Job Agent — Custom keyword groups
CREATE TABLE IF NOT EXISTS job_agent_keyword_groups (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label     TEXT NOT NULL,
  keywords  TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);