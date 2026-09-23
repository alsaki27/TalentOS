-- Retune the four application-pipeline agents from the legacy 45/60-second
-- database values. The code defaults were already widened, but ai_agent_configs
-- takes precedence at runtime, so the live rows remained too aggressive.
--
-- This is intentionally guarded: only the known legacy values are changed.
-- Any future manager-approved custom configuration is left untouched.

UPDATE ai_agent_configs
SET timeout_ms = CASE automation_id
      WHEN 'application_job_lens' THEN 150000
      WHEN 'application_resume_forge' THEN 180000
      WHEN 'application_hiring_panel' THEN 150000
      WHEN 'application_final_polish' THEN 220000
      ELSE timeout_ms
    END,
    max_attempts = CASE automation_id
      WHEN 'application_job_lens' THEN 2
      WHEN 'application_resume_forge' THEN 2
      WHEN 'application_hiring_panel' THEN 2
      WHEN 'application_final_polish' THEN 2
      ELSE max_attempts
    END,
    updated_at = NOW()
WHERE automation_id IN (
  'application_job_lens',
  'application_resume_forge',
  'application_hiring_panel',
  'application_final_polish'
)
AND (
  (automation_id IN ('application_job_lens', 'application_hiring_panel') AND timeout_ms = 45000)
  OR (automation_id = 'application_resume_forge' AND timeout_ms = 90000)
  OR (automation_id = 'application_final_polish' AND timeout_ms = 60000)
);
