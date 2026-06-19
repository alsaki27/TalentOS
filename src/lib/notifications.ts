// src/lib/notifications.ts
// Helper for creating user notifications.

import { supabase } from "./supabase";

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
