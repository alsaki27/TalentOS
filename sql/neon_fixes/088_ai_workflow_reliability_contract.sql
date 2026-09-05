-- 088: make AI workflow execution reproducible and recoverable.
-- Additive only. Do not run against production until the duplicate/stale-row
-- dry run has been reviewed; existing audit and resume artifacts are retained.

ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS routing_state_id uuid REFERENCES ai_routing_states(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_retry_count integer NOT NULL DEFAULT 0
    CHECK (stage_retry_count >= 0);

CREATE INDEX IF NOT EXISTS application_ai_workflows_dispatch_idx
  ON application_ai_workflows (status, next_retry_at, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS application_ai_workflows_routing_state_idx
  ON application_ai_workflows (routing_state_id)
  WHERE routing_state_id IS NOT NULL;

-- The application code uses these fields to distinguish physical audit rows
-- from logical stage attempts. The existing rows are intentionally preserved.
ALTER TABLE application_ai_stage_runs
  ADD COLUMN IF NOT EXISTS claim_lock_version integer,
  ADD COLUMN IF NOT EXISTS logical_attempt_key text;

CREATE INDEX IF NOT EXISTS application_ai_stage_runs_workflow_status_idx
  ON application_ai_stage_runs (workflow_id, status, sequence_number, attempt_number);

-- Backfill the new scalar pin from the JSON snapshot where earlier reliability
-- work already recorded it. This is idempotent and does not change routing.
UPDATE application_ai_workflows
SET routing_state_id = NULLIF(config_snapshot ->> 'routingStateId', '')::uuid
WHERE routing_state_id IS NULL
  AND jsonb_typeof(config_snapshot -> 'routingStateId') = 'string'
  AND NULLIF(config_snapshot ->> 'routingStateId', '') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

UPDATE application_ai_stage_runs
SET logical_attempt_key = workflow_id::text || ':' || sequence_number::text || ':' || attempt_number::text
WHERE logical_attempt_key IS NULL;
