// src/lib/notifications.ts
// Helper for creating user notifications.

import { execute } from "@/server/db/neon";

export interface CreateNotificationOptions {
  userId: string;
  type?: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

export async function createNotification(opts: CreateNotificationOptions): Promise<void> {
  await execute(
    `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [opts.userId, opts.type ?? "info", opts.title, opts.body ?? null, opts.link ?? null, opts.entityType ?? null, opts.entityId ?? null]
  );
}
