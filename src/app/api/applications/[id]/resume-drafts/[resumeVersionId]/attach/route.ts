// src/app/api/applications/[id]/resume-drafts/[resumeVersionId]/attach/route.ts
// POST -> attach selected draft to the application packet

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createOrUpdatePacket } from "@/server/repositories/applicationResumeVersionsRepository";
import { findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string; resumeVersionId: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const resumeVersionId = params.resumeVersionId;

  // Verify the version exists
  const version = await findResumeVersionById(resumeVersionId);
  if (!version) {
    return NextResponse.json({ error: "Resume version not found" }, { status: 404 });
  }

  await createOrUpdatePacket(applicationId, resumeVersionId);

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "update",
    description: `Attached resume version ${resumeVersionId} to application ${applicationId} packet`,
    entityType: "application_packet",
    entityId: applicationId,
    metadata: { application_id: applicationId, resume_version_id: resumeVersionId },
  });

  return NextResponse.json({ ok: true, applicationId, resumeVersionId });
}
