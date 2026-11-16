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
  // Phase 4 of the AI Resume Pipeline Waste Removal & Quality Hardening plan
  // (2026-09-28). When true, Final Polish's AI call is skipped for a draft
  // that's already clean: Hiring Panel returned zero requiredEdits, the
  // measured page fit already recommends "pass", and the deterministic QA
  // module (deterministicQa.ts) reports ok:true with zero hard failures. All
  // of Final Polish's existing deterministic post-processing (identity
  // guards, bullet padding, render+trim, export gates) still runs unchanged
  // on the draft in that case - only the AI call itself is skipped. Defaults
  // false: needs the plan's own A/B + blind-review exit gate before
  // enabling, same instant-revert pattern as pooled_retry_bounded_by_route_rank.
  final_polish_skip_when_clean: boolean;
  updated_by: string | null;
  updated_at: string | null;
  resume_pipeline_settings?: unknown;
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
  final_polish_skip_when_clean: false,
  updated_by: null,
  updated_at: null,
};

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const row = await queryOne<AiRuntimeConfig>(
    `SELECT c.active_routing_state_id, s.name AS active_routing_state_name,
            c.allow_unrouted_fallback, c.workflow_max_concurrency,
            c.workflow_claim_ttl_seconds, c.pooled_retry_bounded_by_route_rank,
            c.final_polish_skip_when_clean,
            c.updated_by, c.updated_at, to_jsonb(c)->'resume_pipeline_settings' AS resume_pipeline_settings
     FROM ai_runtime_config c
     LEFT JOIN ai_routing_states s ON s.id = c.active_routing_state_id
     WHERE c.singleton = true`
  );
  return row ?? DEFAULTS;
}

export function resumePipelineSettings(runtime: AiRuntimeConfig) {
  const value = (runtime.resume_pipeline_settings ?? {}) as Record<string, unknown>;
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const n = value[name];
    return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    evidenceEnabled: value.evidence_enabled === true,
    recoveryMode: value.recovery_mode === "enabled" ? "enabled" as const : "report" as const,
    staleHeartbeatSeconds: bounded("stale_heartbeat_seconds", 300, 60, 3600),
    recoveryLimit: bounded("recovery_limit", 2, 1, 8),
    recoveryBatch: bounded("recovery_batch", 12, 1, 40),
    recoveryDelaySeconds: bounded("recovery_delay_seconds", 60, 1, 1800),
    cooldownLimit: bounded("cooldown_limit", 8, 1, 20),
    cooldownDelaySeconds: bounded("cooldown_delay_seconds", 900, 30, 86400),
    forgeInputChars: bounded("forge_input_chars", 10000, 4000, 20000),
    resumeMaxPages: bounded("resume_max_pages", 2, 1, 3),
  };
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
