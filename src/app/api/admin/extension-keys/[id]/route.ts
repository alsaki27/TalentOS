// DELETE /api/admin/extension-keys/[id]
// Revoke an extension API key — safety-gated.

import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/server/db/neon";
import { guardedSafetyCheck } from "@/lib/safetyCheck";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const confirm = body.confirm === true;

    const safety = await guardedSafetyCheck({
      operation: "delete",
      resource: "extension_api_keys",
      confirm,
      bulkCount: 1,
      hasFilters: true, // specific ID
      detail: `Revoke key ${params.id}`,
    });

    if (!safety.allowed) {
      return NextResponse.json(
        { error: safety.blockedReason ?? "Operation blocked by safety guard" },
        { status: 403 }
      );
    }

    const key = await queryOne<{ id: string; revoked_at: string | null }>(
      `SELECT id, revoked_at FROM extension_api_keys WHERE id = $1`,
      [params.id]
    );
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    if (key.revoked_at) {
      return NextResponse.json({ error: "Key is already revoked" }, { status: 409 });
    }

    await execute(
      `UPDATE extension_api_keys SET revoked_at = NOW() WHERE id = $1`,
      [params.id]
    );

    return NextResponse.json({ id: params.id, revoked: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}