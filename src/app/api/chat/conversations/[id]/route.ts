// src/app/api/chat/conversations/[id]/route.ts
// GET    -> full message history for one conversation (user/assistant turns only —
//           tool-call rows are stored for audit but not shown in the transcript)
// DELETE -> remove a conversation (cascades to its messages)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const { data: conversation, error: convErr } = await supabase
    .from("chat_conversations")
    .select("id, title, user_id")
    .eq("id", params.id)
    .single();

  if (convErr || !conversation || conversation.user_id !== context!.profile.user_id) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, attachment_url, attachment_name, attachment_type, created_at")
    .eq("conversation_id", params.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: conversation.id, title: conversation.title, messages: messages ?? [] });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select("user_id")
    .eq("id", params.id)
    .single();

  if (!conversation || conversation.user_id !== context!.profile.user_id) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { error } = await supabase.from("chat_conversations").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
