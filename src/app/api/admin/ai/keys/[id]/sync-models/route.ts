import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { sanitizeApiError } from "@/lib/utils";
import { discoverModelsForKey } from "@/server/services/aiModelDiscoveryService";
import { recordAuditEvent } from "@/server/repositories/aiAdminAuditRepository";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const result = await discoverModelsForKey(params.id);

    await recordAuditEvent({
      actorUserId: context?.profile.user_id,
      actorEmail: context?.profile.email,
      action: "models_synced",
      aiKeyId: params.id,
      metadata: { success: !result.error, modelCount: result.models.length },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
