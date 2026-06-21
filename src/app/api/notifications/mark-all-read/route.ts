// src/app/api/notifications/mark-all-read/route.ts
// POST -> mark all unread notifications as read for the current user

import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";

export async function POST() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (isNeon()) {
    await execute(
      "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
      [context.profile.user_id]
    );
    return NextResponse.json({ ok: true });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.profile.user_id)
      .is("read_at", null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
}
