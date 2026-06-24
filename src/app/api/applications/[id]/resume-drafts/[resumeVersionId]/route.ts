// src/app/api/applications/[id]/resume-drafts/[resumeVersionId]/route.ts
// PATCH -> update a draft (content, title, status, etc.)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { updateApplicationResumeVersion, findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; resumeVersionId: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const resumeVersionId = params.resumeVersionId;
  const body = await req.json();

  // Verify the version exists
  const existing = await findResumeVersionById(resumeVersionId);
  if (!existing) {
    return NextResponse.json({ error: "Resume version not found" }, { status: 404 });
  }

  const allowedFields: Record<string, unknown> = {};
  const permittedKeys = ["content", "formatting", "status", "ats_score", "truth_score", "one_page_fit_score", "title", "version_label", "generated_text"];
  for (const key of permittedKeys) {
    if (key in body) allowedFields[key] = body[key];
  }

  if (Object.keys(allowedFields).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await updateApplicationResumeVersion(resumeVersionId, allowedFields);

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `Updated resume draft ${resumeVersionId}`,
    entityType: "application_resume_version",
    entityId: resumeVersionId,
    metadata: { application_id: applicationId, fields: Object.keys(allowedFields) },
  });

  return NextResponse.json({ resumeVersion: updated });
}
