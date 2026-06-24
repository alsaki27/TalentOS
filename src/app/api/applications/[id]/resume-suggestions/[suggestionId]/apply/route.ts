// src/app/api/applications/[id]/resume-suggestions/[suggestionId]/apply/route.ts
// POST -> apply an accepted suggestion to the resume version content

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { applySuggestionToResume } from "@/server/services/resumeSuggestionService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string; suggestionId: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const suggestionId = params.suggestionId;
  const body = await req.json();
  const resumeVersionId = body.resume_version_id as string | undefined;

  if (!resumeVersionId) {
    return NextResponse.json({ error: "resume_version_id is required" }, { status: 400 });
  }

  const result = await applySuggestionToResume(suggestionId, resumeVersionId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `Applied resume suggestion ${suggestionId} to resume version ${resumeVersionId}`,
    entityType: "application_resume_suggestions",
    entityId: suggestionId,
    metadata: { application_id: applicationId, resume_version_id: resumeVersionId },
  });

  return NextResponse.json({ ok: true });
}
