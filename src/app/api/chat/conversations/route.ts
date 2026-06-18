// src/app/api/chat/conversations/route.ts
// GET -> list the current user's conversations, newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, updated_at")
    .eq("user_id", context!.profile.user_id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
