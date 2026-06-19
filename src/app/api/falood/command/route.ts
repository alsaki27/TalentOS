// src/app/api/falood/command/route.ts
// POST -> single entry point for the Falood CLI/chat panel (brief section 18). Gathers
// context server-side, calls the configured AI provider, and returns a proposed action
// — never mutates resume content directly. Logs every turn to falood_conversations/
// falood_messages (same shape as chat_conversations/chat_messages).
//
// Only mode="base_resume_creation" is implemented (Phase 2). Other modes return 501
// rather than silently no-oping, matching this app's fail-clearly convention.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { runBaseResumeCommand } from "@/lib/ai/faloodBaseResume";

type FaloodMode = "candidate_profile_setup" | "base_resume_creation" | "application_resume_tailoring" | "pdf_preview_adjustment";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const mode = body.mode as FaloodMode | undefined;
  const command = body.command as string | undefined;
  const message = body.message as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const candidateId = body.candidateId as string | undefined;
  let conversationId = body.conversationId as string | undefined;

  if (!mode) return NextResponse.json({ error: "mode is required" }, { status: 400 });
  if (!command && !message) return NextResponse.json({ error: "command or message is required" }, { status: 400 });

  if (mode !== "base_resume_creation") {
    return NextResponse.json({ error: `Falood mode "${mode}" is not implemented yet.` }, { status: 501 });
  }
  if (!baseResumeId) return NextResponse.json({ error: "baseResumeId is required for base_resume_creation" }, { status: 400 });

  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("falood_conversations")
      .insert({ mode, candidate_id: candidateId ?? null, base_resume_id: baseResumeId, user_id: context!.profile.user_id })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = created.id;
  }

  await supabase.from("falood_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: command ?? message,
    command: command ?? null,
  });

  const result = await runBaseResumeCommand({ baseResumeId, command, message });

  if ("error" in result) {
    await supabase.from("falood_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: `(error) ${result.error}`,
    });
    return NextResponse.json({ conversationId, error: result.error }, { status: 502 });
  }

  await supabase.from("falood_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: result.message,
  });
  if (result.action) {
    await supabase.from("falood_messages").insert({
      conversation_id: conversationId,
      role: "action",
      action_json: result.action,
    });
  }
  await supabase.from("falood_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  return NextResponse.json({ conversationId, ...result });
}
