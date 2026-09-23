// src/lib/activity.ts
// Helper for logging activity to the activity_logs table.

import { execute } from "@/server/db/neon";

export interface LogActivityOptions {
  userId?: string;
  actorName?: string;
  actorType?: string;
  type: string;
  description: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity(opts: LogActivityOptions): Promise<void> {
  await execute(
    `INSERT INTO activity_logs (user_id, actor_name, actor_type, type, description, entity_type, entity_id, entity_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      opts.userId ?? null,
      opts.actorName ?? null,
      opts.actorType ?? "user",
      opts.type,
      opts.description,
      opts.entityType ?? null,
      opts.entityId ?? null,
      opts.entityName ?? null,
      opts.metadata ?? {},
    ]
  );
}
