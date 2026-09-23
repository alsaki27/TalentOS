-- Job Agent — Default AI Control Center config
-- Seeds ai_agent_configs for automation_id = 'job_categorization' so the Job Agent
-- classifier has an active, editable config in /admin/ai from day one.
-- Run against the Neon database.

INSERT INTO ai_agent_configs (
  automation_id,
  display_name,
  system_prompt,
  prompt_version,
  output_schema_version,
  temperature,
  max_output_tokens,
  timeout_ms,
  max_attempts,
  approval_policy,
  minimum_score,
  is_active
)
SELECT
  'job_categorization',
  'Job Agent Classifier',
  'You are a strict, literal job-posting classifier. Respond with raw JSON only.',
  '1',
  'JobAgentClassifierV1',
  0.2,
  2048,
  30000,
  2,
  'auto',
  0,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM ai_agent_configs WHERE automation_id = 'job_categorization'
);
