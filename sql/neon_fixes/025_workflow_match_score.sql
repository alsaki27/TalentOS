-- 025: Add domain-match transparency columns to application_ai_workflows
-- so the resume-parsing-status page and the workflow audit log can show
-- which base resume was selected and why, rather than always picking the
-- most recent one with no explanation.
ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS match_score numeric,
  ADD COLUMN IF NOT EXISTS match_reason text;
