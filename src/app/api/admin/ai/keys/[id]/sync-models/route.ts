import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { sanitizeApiError } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rateLimit";
import { discoverModelsForKey } from "@/server/services/aiModelDiscoveryService";
import { recordAuditEvent } from "@/server/repositories/aiAdminAuditRepository";

export const dynamic = "force-dynamic";

// Rate limit: max 5 model syncs per key per hour.
// NOTE: For production, configure Cloudflare WAF rate-limiting rules on
// /api/admin/ai/keys/*/sync-models to enforce this across all edge instances.
const SYNC_RATE_LIMIT = { maxRequests: 5, windowMs: 60 * 60 * 1000 };

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const rl = checkRateLimit(`sync-models:${params.id}`, SYNC_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many model sync requests for this key. Try again later.` },
      { status: 429 }
    );
  }

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
