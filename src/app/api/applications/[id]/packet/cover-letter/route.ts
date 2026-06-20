// src/app/api/applications/[id]/packet/cover-letter/route.ts
// POST -> generate and save cover letter draft

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { generateCoverLetterDraft } from "@/server/services/applicationPacketAiService";
import { updatePacket } from "@/server/repositories/applicationPacketsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const options = body.options ?? {};

  try {
    const result = await generateCoverLetterDraft(applicationId, options);

    if (!result.coverLetter && result.warnings?.some((w) => w.includes("No AI provider configured"))) {
      return NextResponse.json(
        { error: "AI provider not configured", message: result.warnings[0] },
        { status: 503 }
      );
    }

    if (!result.coverLetter) {
      return NextResponse.json(
        { error: result.warnings?.[0] || "Cover letter generation failed" },
        { status: 500 }
      );
    }

    await updatePacket(applicationId, { cover_letter: result.coverLetter });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Generated cover letter draft for application ${applicationId}`,
      entityType: "application_packet",
      entityId: applicationId,
      metadata: {
        application_id: applicationId,
        subject: result.subject,
        warnings: result.warnings,
      },
    });

    return NextResponse.json({
      coverLetter: result.coverLetter,
      subject: result.subject,
      warnings: result.warnings,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Cover letter generation failed" },
      { status: 500 }
    );
  }
}
