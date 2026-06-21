// src/app/api/chat/conversations/route.ts
// GET -> list the current user's conversations, newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await query<{ id: string; title: string; updated_at: string }>(
        `SELECT id, title, updated_at FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
        [context!.profile.user_id]
      );
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .eq("user_id", context!.profile.user_id)
      .order("updated_at", { ascending: false })
      .limit(50);
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
