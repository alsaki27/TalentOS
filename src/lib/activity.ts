// src/lib/activity.ts
// Helper for logging activity to the activity_logs table.

import { supabase } from "./supabase";

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
  await supabase.from("activity_logs").insert({
    user_id: opts.userId ?? null,
    actor_name: opts.actorName ?? null,
    actor_type: opts.actorType ?? "user",
    type: opts.type,
    description: opts.description,
    entity_type: opts.entityType ?? null,
    entity_id: opts.entityId ?? null,
    entity_name: opts.entityName ?? null,
    metadata: opts.metadata ?? {},
  });
}
