import { execute, queryOne } from "@/server/db/neon";

export interface AiRuntimeConfig {
  active_routing_state_id: string | null;
  active_routing_state_name: string | null;
  allow_unrouted_fallback: boolean;
  workflow_max_concurrency: number;
  workflow_claim_ttl_seconds: number;
  updated_by: string | null;
  updated_at: string | null;
}

const DEFAULTS: AiRuntimeConfig = {
  active_routing_state_id: null,
  active_routing_state_name: null,
  allow_unrouted_fallback: false,
  workflow_max_concurrency: 5,
  workflow_claim_ttl_seconds: 420,
  updated_by: null,
  updated_at: null,
};

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const row = await queryOne<AiRuntimeConfig>(
    `SELECT c.active_routing_state_id, s.name AS active_routing_state_name,
            c.allow_unrouted_fallback, c.workflow_max_concurrency,
            c.workflow_claim_ttl_seconds, c.updated_by, c.updated_at
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
