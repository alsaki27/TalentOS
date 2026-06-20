// src/lib/notifications.ts
// Helper for creating user notifications.

import { supabase } from "./supabase";
import { isNeon } from "@/server/db";
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
  if (isNeon()) {
    await execute(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [opts.userId, opts.type ?? "info", opts.title, opts.body ?? null, opts.link ?? null, opts.entityType ?? null, opts.entityId ?? null]
    );
  } else {
    await supabase.from("notifications").insert({
      user_id: opts.userId,
      type: opts.type ?? "info",
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
    });
  }
}
