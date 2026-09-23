// src/app/api/candidates/[id]/resumes/[resumeId]/route.ts
// DELETE -> remove a resume/cover-letter variant

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { queryOne, execute } from "@/server/db/neon";
import { deleteResumeFile } from "@/lib/resumeStorage";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; resumeId: string } }) {
  const currentUser = await getCurrentUserContext();

  let resume;
  resume = await queryOne<{ file_url: string | null; label: string | null; kind: string | null }>(
    'SELECT file_url, label, kind FROM resumes WHERE id = $1 AND candidate_id = $2',
    [params.resumeId, params.id]
  );

  await execute('DELETE FROM resumes WHERE id = $1 AND candidate_id = $2', [params.resumeId, params.id]);

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
