-- Retune the workflow claim TTL from 900s (15min) down to 720s (12min).
--
-- The 900s value (080_ai_workflow_lease_hardening.sql) was sized to survive
-- a *nested* retry structure: applicationAiWorkflowService.ts wrapped its own
-- up-to-3-attempt fallback loop around routing.ts's callWithUsageTracking,
-- which itself retried up to 3 times internally - a worst case of up to 9
-- real attempts per stage. That nesting has been collapsed to a single flat
-- retry budget (routing.ts MAX_RETRIES reduced, the outer service-level loop
-- reduced to match), so the worst case per stage is now bounded by a much
-- smaller number of attempts.
--
-- 720s is not a guess: it is sized against real ai_usage_events latency for
-- *successful* calls over the trailing 7 days (outcome = 'success'), which
-- showed OpenCode's real tail running p99 69-157s and max 179s across the 4
-- pipeline agents. A shorter TTL (e.g. the 180s originally proposed before
-- this data was pulled) would risk reclaiming workflows that were still
-- correctly in-flight on a slow-but-genuine successful call - recreating the
-- exact "gives up too early" failure mode this migration exists to avoid.
-- 720s covers a full worst-case flat retry budget (up to 4 attempts at ~180s
-- each) with headroom, while still being 20% of the old 900s ceiling.
--
-- Paired with the heartbeat/reclaim changes in applicationAiWorkflowRepository.ts
-- (small incremental heartbeat extension instead of a full TTL reset every
-- beat; stale-heartbeat window tightened from 5min to 90s; reclaim attempts
-- before hard-failing a workflow dropped from 3 to 1), a genuinely stuck
-- workflow now surfaces in well under a couple of minutes instead of silently
-- retrying for up to an hour, without cutting off real slow-but-successful calls.
ALTER TABLE ai_runtime_config
  ALTER COLUMN workflow_claim_ttl_seconds SET DEFAULT 720;

UPDATE ai_runtime_config
SET workflow_claim_ttl_seconds = 720,
    updated_at = NOW()
WHERE singleton = true
  AND workflow_claim_ttl_seconds > 720;
