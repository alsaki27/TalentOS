ALTER TABLE ai_runtime_config
  ADD COLUMN IF NOT EXISTS resume_pipeline_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS stage_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_reason text;

ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS release_receipt jsonb;

CREATE OR REPLACE FUNCTION invalidate_resume_release_on_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.release_receipt IS NOT NULL AND (
    NEW.content IS DISTINCT FROM OLD.content OR NEW.formatting IS DISTINCT FROM OLD.formatting
    OR NEW.generated_text IS DISTINCT FROM OLD.generated_text
  ) THEN
    NEW.release_receipt := NULL;
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS application_resume_release_on_edit ON application_resume_versions;
CREATE TRIGGER application_resume_release_on_edit BEFORE UPDATE OF content, formatting, generated_text
  ON application_resume_versions FOR EACH ROW EXECUTE FUNCTION invalidate_resume_release_on_edit();

CREATE OR REPLACE FUNCTION require_approved_evidence_resume() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.application_stage, NEW.ae_stage) IN ('ready_for_application', 'applied')
    AND (COALESCE(NEW.application_stage, NEW.ae_stage) IS DISTINCT FROM COALESCE(OLD.application_stage, OLD.ae_stage)
      OR NEW.applied_at IS DISTINCT FROM OLD.applied_at)
    AND EXISTS (
      SELECT 1 FROM application_ai_workflows w WHERE w.id = NEW.ai_workflow_id
        AND w.config_snapshot->>'pipelineVariant' = 'resume_evidence_v2'
    ) AND NOT EXISTS (
      SELECT 1 FROM application_resume_versions v
      JOIN application_resume_exports x ON x.id::text = v.release_receipt->>'exportId'
        AND x.resume_version_id = v.id AND x.application_id = NEW.id
        AND x.status = 'created' AND x.export_type = 'pdf'
        AND x.content_sha256 = v.release_receipt->>'pdfHash'
      WHERE v.id = NEW.tailored_resume_version_id AND v.workflow_id = NEW.ai_workflow_id
        AND v.status = 'approved'
    ) THEN
    RAISE EXCEPTION 'Approve and validate the current resume PDF before moving this application forward'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS application_evidence_resume_release_gate ON applications;
CREATE TRIGGER application_evidence_resume_release_gate
  BEFORE UPDATE OF application_stage, ae_stage, applied_at ON applications
  FOR EACH ROW EXECUTE FUNCTION require_approved_evidence_resume();

CREATE INDEX IF NOT EXISTS ai_workflows_recovery_scan_idx
  ON application_ai_workflows (status, claim_expires_at, id)
  WHERE status IN ('running', 'waiting');
CREATE INDEX IF NOT EXISTS ai_workflows_recovery_due_idx
  ON application_ai_workflows (recovery_due_at, id)
  WHERE status = 'queued' AND recovery_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS application_resume_model_checkpoints (
  input_hash text PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES application_ai_workflows(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('reserved','completed','uncertain')),
  result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (result IS NOT NULL))
);

INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES
 ('application_resume_forge_evidence_v2','Resume Forge (evidence pipeline)','One compact evidence selection request','Resume pipeline',true),
 ('application_hiring_panel_evidence_v2','Hiring Panel (evidence pipeline)','Review the cited draft','Resume pipeline',true),
 ('application_final_polish_evidence_v2','Final Polish (evidence pipeline)','Resolve material review issues','Resume pipeline',true),
 ('application_opportunity_reviewer','Opportunity Reviewer','Identify missed supported evidence','Resume pipeline',true),
 ('application_release_editor','Release Editor','Resolve evidence placement before document validation','Resume pipeline',true)
ON CONFLICT (id) DO NOTHING;

-- These automation IDs are used only by the new workflow variant. Configure
-- the exact Forge key under Agents & Routing before allowing that variant.
INSERT INTO ai_automation_routes (automation_id, provider, model_override, rank, is_enabled)
VALUES
 ('application_hiring_panel_evidence_v2','anthropic','claude-haiku-5-5',1,true),
 ('application_final_polish_evidence_v2','anthropic','claude-haiku-5-5',1,true),
 ('application_opportunity_reviewer','opencode','glm-5.3-flash',1,true),
  ('application_release_editor','opencode','glm-5.3-flash',1,true)
ON CONFLICT (automation_id, rank) DO NOTHING;

-- Bind a unique matching native key. Require a deliberate routing selection
-- in the Control Center when there are zero or multiple matching keys.
WITH entitled AS (
  SELECT id, count(*) OVER () AS total FROM ai_api_keys
  WHERE provider = 'openai' AND is_enabled AND key_fingerprint IS NOT NULL
    AND COALESCE(model,default_model) = 'gpt-6-luna'
)
INSERT INTO ai_automation_routes (automation_id, ai_key_id, provider, model_override, rank, is_enabled)
SELECT 'application_resume_forge_evidence_v2', id, 'openai', 'gpt-6-luna', 1, true
FROM entitled WHERE total = 1
ON CONFLICT (automation_id, rank) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, prompt_version, max_output_tokens, timeout_ms, max_attempts)
VALUES
 ('application_resume_forge_evidence_v2','Resume Forge (evidence pipeline)','evidence-v2',850,65000,1),
 ('application_hiring_panel_evidence_v2','Hiring Panel (evidence pipeline)','evidence-v2',1000,50000,2),
 ('application_final_polish_evidence_v2','Final Polish (evidence pipeline)','evidence-v2',650,40000,2),
 ('application_opportunity_reviewer','Opportunity Reviewer','evidence-v2',550,35000,2),
 ('application_release_editor','Release Editor','evidence-v2',550,35000,2)
ON CONFLICT (automation_id) DO NOTHING;
