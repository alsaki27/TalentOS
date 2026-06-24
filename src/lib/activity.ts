// src/lib/activity.ts
// Helper for logging activity to the activity_logs table.

import { supabase } from "./supabase";
import { isNeon } from "@/server/db";
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
  if (isNeon()) {
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
  } else {
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
}
