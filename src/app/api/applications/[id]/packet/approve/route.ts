// src/app/api/applications/[id]/packet/approve/route.ts
// POST -> mark packet as approved

import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { markPacketApproved } from "@/server/repositories/applicationPacketsRepository";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ASSIGNMENT_MANAGER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  const app = await findApplicationById(applicationId);
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  try {
    const packet = await markPacketApproved(applicationId, context!.profile.user_id);

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Approved application packet for ${applicationId}`,
      entityType: "application_packet",
      entityId: applicationId,
      metadata: {
        application_id: applicationId,
        packet_status: packet.packet_status,
        approved_by: packet.approved_by,
        approved_at: packet.approved_at,
      },
    });

    return NextResponse.json({ packet });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to approve packet" },
      { status: 500 }
    );
  }
}
