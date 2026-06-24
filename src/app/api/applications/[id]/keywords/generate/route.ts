// src/app/api/applications/[id]/keywords/generate/route.ts
// POST -> generate keywords from JD data for an application, then map evidence

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { generateApplicationKeywords } from "@/server/services/applicationKeywordService";
import { mapEvidenceForApplication } from "@/server/services/evidenceMappingService";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { listApplicationKeywords } from "@/server/repositories/applicationKeywordsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;

  // Verify application exists and get candidate_id
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (!app.candidate_id) {
    return NextResponse.json({ error: "Application has no candidate" }, { status: 400 });
  }

  // Generate keywords
  const result = await generateApplicationKeywords(applicationId, context!.profile.user_id);

  if (result.error) {
    const statusCode = result.error.includes("No AI provider") ? 503 : 400;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  // Map evidence
  await mapEvidenceForApplication(applicationId, app.candidate_id);

  // Log activity
  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Generated ${result.keywords.length} JD keywords for application ${applicationId}`,
    entityType: "application_job_keywords",
    entityId: applicationId,
    metadata: { keyword_count: result.keywords.length, ai_used: result.aiAnalysisUsed },
  });

  // Return fresh list
  const keywords = await listApplicationKeywords(applicationId);
  return NextResponse.json({ keywords, aiAnalysisUsed: result.aiAnalysisUsed });
}
