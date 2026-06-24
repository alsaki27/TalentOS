// src/app/api/resume-suggestions/[id]/apply/route.ts
// POST -> apply an accepted suggestion to the application resume content.
// Body: decision (accept|reject|customize), customText?

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

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

  let suggestion: any;
  let suggestionError: any;

  if (isNeon()) {
    suggestion = await queryOne(
      `SELECT * FROM resume_suggestions WHERE id = $1`,
      [params.id]
    );
    suggestionError = suggestion ? null : { message: "Suggestion not found" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("resume_suggestions")
      .select("*")
      .eq("id", params.id)
      .single();
    suggestion = res.data;
    suggestionError = res.error;
  }

  if (suggestionError || !suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (decision === "reject") {
    let error: any;

    if (isNeon()) {
      const res = await execute(
        `UPDATE resume_suggestions SET status = $1, resolved_at = $2 WHERE id = $3`,
        ["rejected", now, params.id]
      );
      error = res.rowCount === 0 ? { message: "Update failed" } : null;
    } else {
      const { supabase } = await import("@/lib/supabase");
      const res = await supabase
        .from("resume_suggestions")
        .update({ status: "rejected", resolved_at: now })
        .eq("id", params.id);
      error = res.error;
    }

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
  let appResume: any;
  let appResumeError: any;

  if (isNeon()) {
    appResume = await queryOne(
      `SELECT content FROM application_resume_versions WHERE id = $1`,
      [suggestion.application_resume_id]
    );
    appResumeError = appResume ? null : { message: "Application resume version not found" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .select("content")
      .eq("id", suggestion.application_resume_id)
      .single();
    appResume = res.data;
    appResumeError = res.error;
  }

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
  let updateResumeError: any;

  if (isNeon()) {
    const res = await execute(
      `UPDATE application_resume_versions SET content = $1, updated_at = $2 WHERE id = $3`,
      [updatedContent, now, suggestion.application_resume_id]
    );
    updateResumeError = res.rowCount === 0 ? { message: "Update failed" } : null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .update({ content: updatedContent, updated_at: now })
      .eq("id", suggestion.application_resume_id);
    updateResumeError = res.error;
  }

  if (updateResumeError) return NextResponse.json({ error: updateResumeError.message }, { status: 500 });

  // Update suggestion status
  const suggestionUpdates: Record<string, unknown> = {
    status: decision === "customize" ? "customized" : "accepted",
    resolved_at: now,
  };
  if (decision === "customize" && customText) {
    suggestionUpdates.user_instruction = customText;
  }

  let updateSuggestionError: any;

  if (isNeon()) {
    const keys = Object.keys(suggestionUpdates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => suggestionUpdates[k]), params.id] as (string | number | boolean | object | Date | null)[];
    const res = await execute(
      `UPDATE resume_suggestions SET ${setClause} WHERE id = $${keys.length + 1}`,
      values
    );
    updateSuggestionError = res.rowCount === 0 ? { message: "Update failed" } : null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("resume_suggestions")
      .update(suggestionUpdates)
      .eq("id", params.id);
    updateSuggestionError = res.error;
  }

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
