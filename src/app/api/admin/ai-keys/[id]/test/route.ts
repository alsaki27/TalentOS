// src/app/api/admin/ai-keys/[id]/test/route.ts
// POST -> test a single AI API key by sending a small request

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { testAiKey } from "@/server/services/aiProvider";

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
