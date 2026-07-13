// src/app/api/chat/conversations/route.ts
// GET -> list the current user's conversations, newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { listUserConversations } from "@/server/repositories/chatRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const data = await listUserConversations(context!.profile.user_id);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
