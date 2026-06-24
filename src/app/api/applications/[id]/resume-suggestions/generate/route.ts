// src/app/api/applications/[id]/resume-suggestions/generate/route.ts
// POST -> generate AI suggestions using approved keywords + truth check

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { generateResumeSuggestions } from "@/server/services/resumeSuggestionService";
import { listSuggestionsByApplication } from "@/server/repositories/applicationResumeSuggestionsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const body = await req.json();
  const resumeVersionId = (body.resume_version_id as string) ?? null;

  const result = await generateResumeSuggestions(applicationId, resumeVersionId, context!.profile.user_id);

  if (result.error) {
    const statusCode = result.error.includes("No AI provider") ? 503
      : result.error.includes("No approved keywords") ? 400
      : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Generated ${result.suggestions.length} AI resume suggestions for application ${applicationId}`,
    entityType: "application_resume_suggestions",
    entityId: applicationId,
    metadata: { suggestion_count: result.suggestions.length, ai_used: result.aiAnalysisUsed, resume_version_id: resumeVersionId },
  });

  // Return fresh list
  const suggestions = await listSuggestionsByApplication(applicationId);
  return NextResponse.json({ suggestions, applicationId, aiAnalysisUsed: result.aiAnalysisUsed });
}
