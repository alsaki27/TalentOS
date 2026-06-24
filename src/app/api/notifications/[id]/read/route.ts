// src/app/api/notifications/[id]/read/route.ts
// POST -> mark a single notification as read

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (isNeon()) {
    await execute(
      "UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2",
      [params.id, context.profile.user_id]
    );
    return NextResponse.json({ ok: true });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("user_id", context.profile.user_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
}
