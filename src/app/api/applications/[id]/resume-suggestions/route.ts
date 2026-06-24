// src/app/api/applications/[id]/resume-suggestions/route.ts
// GET  -> list suggestions for the application
// POST -> create a manual suggestion

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import {
  listSuggestionsByApplication,
  createSuggestion,
} from "@/server/repositories/applicationResumeSuggestionsRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const applicationId = params.id;
  const suggestions = await listSuggestionsByApplication(applicationId);
  return NextResponse.json({ suggestions, applicationId });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const applicationId = params.id;

  const suggestion = await createSuggestion({
    application_id: applicationId,
    resume_version_id: body.resume_version_id ?? null,
    keyword_id: body.keyword_id ?? null,
    suggestion_type: body.suggestion_type,
    target_section: body.target_section,
    target_subsection_id: body.target_subsection_id ?? null,
    original_text: body.original_text ?? null,
    proposed_text: body.proposed_text,
    ai_reasoning: body.ai_reasoning ?? null,
    truth_status: body.truth_status ?? "unverified",
    truth_check_details: body.truth_check_details ?? null,
    source_evidence: body.source_evidence ?? null,
    status: body.status ?? "pending",
    user_notes: body.user_notes ?? null,
  });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Created resume suggestion for application ${applicationId}`,
    entityType: "application_resume_suggestions",
    entityId: suggestion.id,
    metadata: { application_id: applicationId, suggestion_type: body.suggestion_type, target_section: body.target_section },
  });

  return NextResponse.json({ suggestion }, { status: 201 });
}
