import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeApiError } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rateLimit";
import { execute, queryOne } from "@/server/db/neon";
import { testAiKey } from "@/server/services/aiProvider";

export const dynamic = "force-dynamic";

// Rate limit: max 10 key tests per key per hour.
// NOTE: For production, configure Cloudflare WAF rate-limiting rules on
// /api/admin/ai/keys/*/test to enforce this across all edge instances.
const TEST_RATE_LIMIT = { maxRequests: 10, windowMs: 60 * 60 * 1000 };

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  const rl = checkRateLimit(`test:${id}`, TEST_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many test requests for this key. Try again later.` },
      { status: 429 }
    );
  }

  try {
    const result = await testAiKey(id);

    await execute(
      `UPDATE ai_api_keys
       SET last_tested_at = $1,
           last_test_status = $2,
           last_test_latency_ms = $3,
           last_error_message = CASE WHEN $4 = true THEN NULL ELSE $5 END,
           updated_at = $1
       WHERE id = $6`,
      [
        new Date().toISOString(),
        result.success ? "working" : "failing",
        result.latencyMs,
        result.success,
        result.error ?? null,
        id,
      ]
    );

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "test",
      description: `Tested AI API key: ${result.success ? "working" : "failing"}${result.error ? ` (${result.error})` : ""}`,
      entityType: "ai_api_key",
      entityId: id,
      entityName: undefined,
      metadata: { success: result.success, latencyMs: result.latencyMs },
    });

    const keyMeta = await queryOne<{ supports_model_discovery: boolean; available_models: any; models_last_synced_at: string | null }>(
      `SELECT supports_model_discovery, available_models, models_last_synced_at FROM ai_api_keys WHERE id = $1`,
      [id]
    );

    return NextResponse.json({
      success: result.success,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
      modelDiscovery: keyMeta?.supports_model_discovery ? { available: true, modelsLastSyncedAt: keyMeta.models_last_synced_at } : { available: false },
    });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
