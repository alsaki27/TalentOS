// src/app/api/applications/[id]/resume-suggestions/[suggestionId]/route.ts
// PATCH -> accept or reject a suggestion

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import {
  updateSuggestion,
  findSuggestionById,
} from "@/server/repositories/applicationResumeSuggestionsRepository";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; suggestionId: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const suggestionId = params.suggestionId;
  const body = await req.json();
  const status = body.status as "accepted" | "rejected" | undefined;
  const userNotes = body.user_notes as string | undefined;

  if (!status || !["accepted", "rejected"].includes(status)) {
    return NextResponse.json({ error: "status must be 'accepted' or 'rejected'" }, { status: 400 });
  }

  // Verify the suggestion belongs to this application
  const existing = await findSuggestionById(suggestionId);
  if (!existing || existing.application_id !== applicationId) {
    return NextResponse.json({ error: "Suggestion not found for this application" }, { status: 404 });
  }

  const updated = await updateSuggestion(suggestionId, {
    status,
    user_notes: userNotes ?? null,
  });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `${status === "accepted" ? "Accepted" : "Rejected"} resume suggestion ${suggestionId}`,
    entityType: "application_resume_suggestions",
    entityId: suggestionId,
    metadata: { application_id: applicationId, status, user_notes: userNotes },
  });

  return NextResponse.json({ suggestion: updated });
}
