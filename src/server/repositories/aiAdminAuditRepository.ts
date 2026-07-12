// src/server/repositories/aiAdminAuditRepository.ts
// Data-access abstraction for the ai_admin_audit_log table.
// Records admin actions against AI keys/automations for traceability.

import { execute } from "@/server/db/neon";

export interface AuditEventInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string; // key_created | key_updated | key_deleted | models_synced | route_changed | agent_test
  aiKeyId?: string | null;
  automationId?: string | null;
  metadata?: Record<string, any>;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  await execute(
    `INSERT INTO ai_admin_audit_log (actor_user_id, actor_email, action, ai_key_id, automation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.actorUserId ?? null, input.actorEmail ?? null, input.action, input.aiKeyId ?? null, input.automationId ?? null, input.metadata ? JSON.stringify(input.metadata) : null]
  );
}