-- 109: allow outcome='discarded' on ai_usage_events. callWithUsageTracking
-- already records a 'success' event the moment a provider call completes;
-- separately, the workflow orchestrator can lose its claim (heartbeat
-- superseded) between that successful call and saving the artifact, and
-- silently discards the paid-for output (applicationAiWorkflowService.ts,
-- assertWorkflowClaim check after the agent call returns). Recording an
-- explicit 'discarded' event at that point lets cost/quality reporting
-- separate "wasted, already-billed work" from real failures, instead of
-- that work vanishing with no trace (see Resume Forge 1,442 successes vs
-- Hiring Panel 2,589 - the asymmetry this is meant to explain).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_outcome_check'
  ) THEN
    ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_outcome_check;
  END IF;
END $$;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_outcome_check
  CHECK (outcome = ANY (ARRAY['success','failure','timeout','skipped','discarded']));
