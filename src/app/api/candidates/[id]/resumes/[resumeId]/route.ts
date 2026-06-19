// src/app/api/candidates/[id]/resumes/[resumeId]/route.ts
// DELETE -> remove a resume/cover-letter variant

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { deleteStorageFile } from "@/lib/storage";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; resumeId: string } }) {
  const currentUser = await getCurrentUserContext();
  const { data: resume } = await supabase
    .from("resumes")
    .select("file_url, label, kind")
    .eq("id", params.resumeId)
    .eq("candidate_id", params.id)
    .single();

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", params.resumeId)
    .eq("candidate_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await deleteStorageFile(resume?.file_url);

  if (currentUser) {
    await logActivity({
      userId: currentUser.profile.user_id,
      actorName: currentUser.profile.display_name || currentUser.profile.email,
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
