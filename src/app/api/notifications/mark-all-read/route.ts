// src/app/api/notifications/mark-all-read/route.ts
// POST -> mark all unread notifications as read for the current user

import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { execute } from "@/server/db/neon";

export async function POST() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  await execute(
    "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
    [context.profile.user_id]
  );
  return NextResponse.json({ ok: true });
}
