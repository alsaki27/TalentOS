// src/app/api/chat/conversations/[id]/route.ts
// GET    -> full message history for one conversation (user/assistant turns only —
//           tool-call rows are stored for audit but not shown in the transcript)
// DELETE -> remove a conversation (cascades to its messages)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findConversation, getConversationMessages, getConversationOwner, deleteConversation } from "@/server/repositories/chatRepository";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const conversation = await findConversation(params.id);
  if (!conversation || conversation.user_id !== context!.profile.user_id) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const messages = await getConversationMessages(params.id);
  return NextResponse.json({ id: conversation.id, title: conversation.title, messages: messages ?? [] });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const ownerId = await getConversationOwner(params.id);
  if (!ownerId || ownerId !== context!.profile.user_id) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  await deleteConversation(params.id);
  return NextResponse.json({ ok: true });
}
