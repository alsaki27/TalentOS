// src/app/api/notifications/mark-all-read/route.ts
// POST -> mark all unread notifications as read for the current user

import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", context.profile.user_id)
    .is("read_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
