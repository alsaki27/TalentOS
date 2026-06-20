// src/app/api/falood/command/route.ts
// POST -> single entry point for the Falood CLI/chat panel (brief section 18). Gathers
// context server-side, calls the configured AI provider, and returns a proposed action
// — never mutates resume content directly. Logs every turn to falood_conversations/
// falood_messages (same shape as chat_conversations/chat_messages).
//
// mode="base_resume_creation" (Phase 2) and mode="application_resume_tailoring"
// (Phase 4 — /suggest-edits and free-text advice) are implemented. The remaining modes
// return 501 rather than silently no-oping, matching this app's fail-clearly convention.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";
import { runBaseResumeCommand } from "@/lib/ai/faloodBaseResume";
import { runApplicationTailoringCommand } from "@/lib/ai/faloodApplicationTailoring";

type FaloodMode = "candidate_profile_setup" | "base_resume_creation" | "application_resume_tailoring" | "pdf_preview_adjustment";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const mode = body.mode as FaloodMode | undefined;
  const command = body.command as string | undefined;
  const message = body.message as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const applicationResumeId = body.applicationResumeId as string | undefined;
  const candidateId = body.candidateId as string | undefined;
  let conversationId = body.conversationId as string | undefined;

  if (!mode) return NextResponse.json({ error: "mode is required" }, { status: 400 });
  if (!command && !message) return NextResponse.json({ error: "command or message is required" }, { status: 400 });

  const activeMode = mode;
  const activeCommand = command;
  const activeMessage = message;

  if (activeMode !== "base_resume_creation" && activeMode !== "application_resume_tailoring") {
    return NextResponse.json({ error: `Falood mode "${activeMode}" is not implemented yet.` }, { status: 501 });
  }
  if (activeMode === "base_resume_creation" && !baseResumeId) {
    return NextResponse.json({ error: "baseResumeId is required for base_resume_creation" }, { status: 400 });
  }
  if (activeMode === "application_resume_tailoring" && !applicationResumeId) {
    return NextResponse.json({ error: "applicationResumeId is required for application_resume_tailoring" }, { status: 400 });
  }

  if (!conversationId) {
    let created: any;
    let error: any;

    if (isNeon()) {
      created = await queryOne(
        `INSERT INTO falood_conversations (mode, candidate_id, base_resume_id, application_resume_id, user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [activeMode, candidateId ?? null, baseResumeId ?? null, applicationResumeId ?? null, context!.profile.user_id]
      );
      error = created ? null : { message: 'Insert failed' };
    } else {
      const res = await supabase
        .from("falood_conversations")
        .insert({
          mode: activeMode,
          candidate_id: candidateId ?? null,
          base_resume_id: baseResumeId ?? null,
          application_resume_id: applicationResumeId ?? null,
          user_id: context!.profile.user_id,
        })
        .select("id")
        .single();
      created = res.data;
      error = res.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = created.id;
  }

  const userContent = activeCommand ?? activeMessage;
  const userCommand = activeCommand ?? null;

  const finalConversationId = conversationId!;

  if (isNeon()) {
    await execute(
      `INSERT INTO falood_messages (conversation_id, role, content, command) VALUES ($1, $2, $3, $4)`,
      [finalConversationId, "user", userContent, userCommand]
    );
  } else {
    await supabase.from("falood_messages").insert({
      conversation_id: finalConversationId,
      role: "user",
      content: userContent,
      command: userCommand,
    });
  }

  const result = activeMode === "base_resume_creation"
    ? await runBaseResumeCommand({ baseResumeId: baseResumeId!, command: activeCommand, message: activeMessage })
    : await runApplicationTailoringCommand({ applicationResumeId: applicationResumeId!, command: activeCommand, message: activeMessage });

  if ("error" in result) {
    if (isNeon()) {
      await execute(
        `INSERT INTO falood_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [finalConversationId, "assistant", `(error) ${result.error}`]
      );
    } else {
      await supabase.from("falood_messages").insert({
        conversation_id: finalConversationId,
        role: "assistant",
        content: `(error) ${result.error}`,
      });
    }
    return NextResponse.json({ conversationId: finalConversationId, error: result.error }, { status: 502 });
  }

  if (isNeon()) {
    await execute(
      `INSERT INTO falood_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [finalConversationId, "assistant", result.message]
    );
    if (result.action) {
      await execute(
        `INSERT INTO falood_messages (conversation_id, role, action_json) VALUES ($1, $2, $3)`,
        [finalConversationId, "action", result.action]
      );
    }
    await execute(
      `UPDATE falood_conversations SET updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), finalConversationId]
    );
  } else {
    await supabase.from("falood_messages").insert({
      conversation_id: finalConversationId,
      role: "assistant",
      content: result.message,
    });
    if (result.action) {
      await supabase.from("falood_messages").insert({
        conversation_id: finalConversationId,
        role: "action",
        action_json: result.action,
      });
    }
    await supabase.from("falood_conversations").update({ updated_at: new Date().toISOString() }).eq("id", finalConversationId);
  }

  return NextResponse.json({ conversationId: finalConversationId, ...result });
}
