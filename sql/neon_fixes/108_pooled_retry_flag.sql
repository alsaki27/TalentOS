-- Feature flag for the pooled-provider retry-cap fix (routing.ts,
-- callWithUsageTracking). When true, an attempt against a pooled provider
-- (OpenCode, Vertex proxy) only counts against maxProviderAttempts when it
-- advances to a different route rank - a genuine model/provider chain
-- advance. Same-rank retries (a sibling account in the same provider's pool)
-- are instead bounded by the routing exclusion sets emptying out, so a 5+
-- account pool can be fully tried for one model before the state's next
-- model is ever attempted. Defaults false so rollout is opt-in and
-- instantly revertible with a single UPDATE, no deploy required.
ALTER TABLE ai_runtime_config
  ADD COLUMN IF NOT EXISTS pooled_retry_bounded_by_route_rank boolean NOT NULL DEFAULT false;
