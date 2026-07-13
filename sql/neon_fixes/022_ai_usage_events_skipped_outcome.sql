-- 022: ai_usage_events.outcome CHECK constraint doesn't allow 'skipped',
-- but src/lib/ai/routing.ts's getProviderForAutomation() records outcome:
-- "skipped" whenever a route is passed over for hitting its rate/quota
-- limit (checkKeyLimits returns not allowed) - a normal, expected event
-- when multiple workflows run concurrently against a shared key. That
-- INSERT throws "violates check constraint ai_usage_events_outcome_check"
-- since 'skipped' isn't in the allowed set, which propagates out of
-- getProviderForAutomation (the call isn't wrapped in try/catch) and can
-- surface as "All configured routes failed and global fallback is
-- disabled" even when a later route in the chain would have worked.
-- Confirmed live under concurrent load (multiple candidates' workflows
-- hitting the same key's rate limit at once).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_outcome_check'
  ) THEN
    ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_outcome_check;
  END IF;
END $$;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_outcome_check
  CHECK (outcome = ANY (ARRAY['success','failure','timeout','skipped']));
