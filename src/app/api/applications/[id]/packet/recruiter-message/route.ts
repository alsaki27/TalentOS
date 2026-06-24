// src/app/api/applications/[id]/packet/recruiter-message/route.ts
// POST -> generate and save recruiter message draft

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { generateRecruiterMessageDraft } from "@/server/services/applicationPacketAiService";
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
    const result = await generateRecruiterMessageDraft(applicationId, options);

    if (!result.message && result.warnings?.some((w) => w.includes("No AI provider configured"))) {
      return NextResponse.json(
        { error: "AI provider not configured", message: result.warnings[0] },
        { status: 503 }
      );
    }

    if (!result.message) {
      return NextResponse.json(
        { error: result.warnings?.[0] || "Recruiter message generation failed" },
        { status: 500 }
      );
    }

    await updatePacket(applicationId, { recruiter_message: result.message });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "create",
      description: `Generated recruiter message draft for application ${applicationId}`,
      entityType: "application_packet",
      entityId: applicationId,
      metadata: {
        application_id: applicationId,
        subject: result.subject,
        warnings: result.warnings,
      },
    });

    return NextResponse.json({
      message: result.message,
      subject: result.subject,
      warnings: result.warnings,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Recruiter message generation failed" },
      { status: 500 }
    );
  }
}
