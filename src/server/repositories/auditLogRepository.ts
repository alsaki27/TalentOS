import { execute } from "@/server/db/neon";

export async function recordAuditEvent(input: {
  actor_user_id?: string | null;
  actor_email?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await execute(
    "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
    [input.actor_user_id ?? null, input.actor_email ?? null, input.action, input.entity_type, input.entity_id ?? null, JSON.stringify(input.metadata ?? {})]
  );
}
