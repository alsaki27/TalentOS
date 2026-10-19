-- Raise Resume Forge's per-provider timeout from the live three-minute
-- setting to five minutes. Keep this safe on every deploy and preserve any
-- later admin-selected custom timeout.
WITH changed AS (
  UPDATE ai_agent_configs
  SET timeout_ms = 300000,
      updated_at = NOW()
  WHERE automation_id = 'application_resume_forge'
    AND (timeout_ms IS NULL OR timeout_ms IN (180000, 240000))
  RETURNING automation_id
)
INSERT INTO ai_admin_audit_log (automation_id, action, metadata)
SELECT automation_id,
       'agent_timeout_updated',
       jsonb_build_object('source', '115_resume_forge_timeout_5m', 'timeout_ms', 300000)
FROM changed;
