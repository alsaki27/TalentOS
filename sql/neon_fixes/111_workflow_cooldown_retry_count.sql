-- Phase 5 (2026-09-28): a provider-capacity cooldown (rate_limit /
-- quota_exhausted) deliberately does not increment stage_retry_count when
-- requeuing (applicationAiWorkflowService.ts's isProviderCooldown branch),
-- so it never reaches max_attempts and can requeue every 15 minutes
-- indefinitely if the provider capacity issue never clears (e.g. a genuinely
-- exhausted weekly quota). This tracks cooldown cycles on their own counter,
-- separate from stage_retry_count's existing "ordinary content-error
-- attempt" meaning, so bounding cooldowns doesn't change that field's
-- behavior for any other caller.
ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS cooldown_retry_count integer NOT NULL DEFAULT 0;
