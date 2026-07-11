import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { execute } from "@/server/db/neon";
import { testAiKey } from "@/server/services/aiProvider";

export const dynamic = "force-dynamic";

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

    return NextResponse.json({
      success: result.success,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
