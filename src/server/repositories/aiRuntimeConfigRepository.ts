import { execute, queryOne } from "@/server/db/neon";

export interface AiRuntimeConfig {
  active_routing_state_id: string | null;
  active_routing_state_name: string | null;
  allow_unrouted_fallback: boolean;
  workflow_max_concurrency: number;
  workflow_claim_ttl_seconds: number;
  // When true, callWithUsageTracking only counts an attempt against
  // maxProviderAttempts when it advances to a different route rank (a real
  // model/provider chain advance). Same-rank retries (a sibling account in a
  // pooled provider like OpenCode) are instead bounded by the exclusion sets
  // emptying out, so a 5+ account pool can be fully tried for one model
  // before the state's next model is ever attempted. Defaults false so a
  // rollout is opt-in and instantly revertible without a deploy.
  pooled_retry_bounded_by_route_rank: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

// workflow_claim_ttl_seconds: 720s (12min), sized to a flat retry budget of
// up to 4 attempts at OpenCode's real observed tail latency (p99 up to 157s,
// max 179s in ai_usage_events - see migration 089_lease_heartbeat_retune.sql
// for the full rationale). Not a guess: the old 900s value existed to cover
// a nested-retry worst case that no longer exists after collapsing the
// double retry loop in applicationAiWorkflowService.ts / routing.ts.
const DEFAULTS: AiRuntimeConfig = {
  active_routing_state_id: null,
  active_routing_state_name: null,
  allow_unrouted_fallback: false,
  workflow_max_concurrency: 5,
  workflow_claim_ttl_seconds: 720,
  pooled_retry_bounded_by_route_rank: false,
  updated_by: null,
  updated_at: null,
};

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const row = await queryOne<AiRuntimeConfig>(
    `SELECT c.active_routing_state_id, s.name AS active_routing_state_name,
            c.allow_unrouted_fallback, c.workflow_max_concurrency,
            c.workflow_claim_ttl_seconds, c.pooled_retry_bounded_by_route_rank,
            c.updated_by, c.updated_at
     FROM ai_runtime_config c
     LEFT JOIN ai_routing_states s ON s.id = c.active_routing_state_id
     WHERE c.singleton = true`
  );
  return row ?? DEFAULTS;
}

export async function activateRoutingState(stateId: string, actorUserId?: string | null): Promise<void> {
  await execute(
    `INSERT INTO ai_runtime_config (singleton, active_routing_state_id, updated_by, updated_at)
     VALUES (true, $1, $2, now())
     ON CONFLICT (singleton) DO UPDATE
       SET active_routing_state_id = EXCLUDED.active_routing_state_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [stateId, actorUserId ?? null]
  );
}
