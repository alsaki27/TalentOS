// src/app/api/resume-suggestions/[id]/apply/route.ts
// POST -> apply an accepted suggestion to the application resume content.
// Body: decision (accept|reject|customize), customText?

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

function findAndReplaceInContent(
  content: any,
  targetBlockId: string | null,
  originalText: string,
  newText: string
): boolean {
  if (typeof content !== "object" || content === null) return false;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (findAndReplaceInContent(item, targetBlockId, originalText, newText)) {
        return true;
      }
    }
    return false;
  }

  // If this object matches the target block id (or no id specified), replace the text field
  if (!targetBlockId || content.id === targetBlockId) {
    const textFields = ["text", "degree", "name", "description", "title", "company", "school"];
    for (const field of textFields) {
      if (typeof content[field] === "string" && content[field] === originalText) {
        content[field] = newText;
        return true;
      }
    }
  }

  // Recurse into children
  for (const key of Object.keys(content)) {
    if (findAndReplaceInContent(content[key], targetBlockId, originalText, newText)) {
      return true;
    }
  }

  return false;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const decision = body.decision as "accept" | "reject" | "customize" | undefined;
  const customText = body.customText as string | undefined;

  if (!decision || !["accept", "reject", "customize"].includes(decision)) {
    return NextResponse.json({ error: "decision must be accept, reject, or customize" }, { status: 400 });
  }

  const { data: suggestion, error: suggestionError } = await supabase
    .from("resume_suggestions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (suggestionError || !suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (decision === "reject") {
    const { error } = await supabase
      .from("resume_suggestions")
      .update({ status: "rejected", resolved_at: now })
      .eq("id", params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Rejected resume suggestion ${params.id}`,
      entityType: "resume_suggestion",
      entityId: params.id,
    });

    return NextResponse.json({ ok: true });
  }

  // For accept or customize, we need to apply to the resume content
  const { data: appResume, error: appResumeError } = await supabase
    .from("application_resume_versions")
    .select("content")
    .eq("id", suggestion.application_resume_id)
    .single();

  if (appResumeError || !appResume) {
    return NextResponse.json({ error: "Application resume version not found" }, { status: 404 });
  }

  const content = appResume.content as any;
  const replacementText = decision === "customize" && customText ? customText : suggestion.suggested_text;

  let updatedContent = content;
  const replaced = findAndReplaceInContent(
    updatedContent,
    suggestion.target_block_id,
    suggestion.original_text,
    replacementText
  );

  if (!replaced) {
    // Fallback: try a global string replace in the serialized JSON
    const jsonStr = JSON.stringify(content);
    const updatedJsonStr = jsonStr.replace(
      new RegExp(escapeRegExp(suggestion.original_text), "g"),
      replacementText
    );
    if (jsonStr === updatedJsonStr) {
      return NextResponse.json({ error: "Could not find original text in resume content" }, { status: 409 });
    }
    updatedContent = JSON.parse(updatedJsonStr);
  }

  // Update the application resume content
  const { error: updateResumeError } = await supabase
    .from("application_resume_versions")
    .update({ content: updatedContent, updated_at: now })
    .eq("id", suggestion.application_resume_id);

  if (updateResumeError) return NextResponse.json({ error: updateResumeError.message }, { status: 500 });

  // Update suggestion status
  const suggestionUpdates: Record<string, unknown> = {
    status: decision === "customize" ? "customized" : "accepted",
    resolved_at: now,
  };
  if (decision === "customize" && customText) {
    suggestionUpdates.user_instruction = customText;
  }

  const { error: updateSuggestionError } = await supabase
    .from("resume_suggestions")
    .update(suggestionUpdates)
    .eq("id", params.id);

  if (updateSuggestionError) return NextResponse.json({ error: updateSuggestionError.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `${decision === "customize" ? "Customized" : "Accepted"} resume suggestion ${params.id}`,
    entityType: "resume_suggestion",
    entityId: params.id,
    metadata: { decision, applied: true },
  });

  return NextResponse.json({ ok: true });
}
