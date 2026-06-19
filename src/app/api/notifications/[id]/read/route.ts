// src/app/api/notifications/[id]/read/route.ts
// POST -> mark a single notification as read

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", context.profile.user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
