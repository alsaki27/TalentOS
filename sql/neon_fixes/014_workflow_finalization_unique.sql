-- 011: Prevent duplicate AI-generated resume versions per workflow.
-- Enables INSERT ... ON CONFLICT for atomic finalization in finalizationService.ts.
CREATE UNIQUE INDEX IF NOT EXISTS arv_workflow_ai_agent_unique
ON application_resume_versions (workflow_id)
WHERE source_type = 'ai_agent';
