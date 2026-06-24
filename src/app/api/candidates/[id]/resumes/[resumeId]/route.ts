// src/app/api/candidates/[id]/resumes/[resumeId]/route.ts
// DELETE -> remove a resume/cover-letter variant

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { deleteResumeFile } from "@/lib/resumeStorage";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; resumeId: string } }) {
  const currentUser = await getCurrentUserContext();

  let resume;
  if (isNeon()) {
    resume = await queryOne<{ file_url: string | null; label: string | null; kind: string | null }>(
      'SELECT file_url, label, kind FROM resumes WHERE id = $1 AND candidate_id = $2',
      [params.resumeId, params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("resumes")
      .select("file_url, label, kind")
      .eq("id", params.resumeId)
      .eq("candidate_id", params.id)
      .single();
    resume = data;
  }

  if (isNeon()) {
    await execute('DELETE FROM resumes WHERE id = $1 AND candidate_id = $2', [params.resumeId, params.id]);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase
      .from("resumes")
      .delete()
      .eq("id", params.resumeId)
      .eq("candidate_id", params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await deleteResumeFile(resume?.file_url);

  if (currentUser) {
    await logActivity({
      userId: currentUser.profile.user_id,
      actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
      type: "delete",
      description: `Deleted ${resume?.kind || "resume"} "${resume?.label || params.resumeId}"`,
      entityType: "resume",
      entityId: params.resumeId,
      entityName: resume?.label || undefined,
      metadata: { candidate_id: params.id },
    });
  }

  return NextResponse.json({ ok: true });
}
