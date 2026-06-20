// src/app/api/applications/[id]/packet/route.ts
// GET  -> fetch enriched packet for application
// POST -> build/refresh packet
// PATCH -> update editable packet fields

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser, UserRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { buildApplicationPacket } from "@/server/services/applicationPacketBuilderService";
import { updatePacket } from "@/server/repositories/applicationPacketsRepository";

export const dynamic = "force-dynamic";

const PACKET_VIEWER_ROLES: UserRole[] = [...APPLICATION_WORKER_ROLES, "reviewer"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(PACKET_VIEWER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  try {
    const result = await buildApplicationPacket(applicationId);
    return NextResponse.json({
      packet: result.packet,
      checklist: result.checklist,
      warnings: result.warnings,
      summary: result.summary,
      metadata: result.metadata,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to build packet" }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  try {
    const result = await buildApplicationPacket(applicationId, { actorId: context!.profile.user_id });

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Built/refreshed application packet for ${applicationId}`,
      entityType: "application_packet",
      entityId: applicationId,
      metadata: {
        application_id: applicationId,
        checklist_pass_count: Object.values(result.checklist).filter((v) => v === "pass").length,
        warning_count: result.warnings.length,
      },
    });

    return NextResponse.json({
      packet: result.packet,
      checklist: result.checklist,
      warnings: result.warnings,
      summary: result.summary,
      metadata: result.metadata,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to build packet" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const allowedFields = [
    "cover_letter",
    "recruiter_message",
    "final_notes",
    "checklist",
    "hiring_manager_email",
    "interview_prep_notes",
  ];

  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const packet = await updatePacket(applicationId, updates);

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Updated application packet fields for ${applicationId}`,
      entityType: "application_packet",
      entityId: applicationId,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json({ packet });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update packet" }, { status: 500 });
  }
}
