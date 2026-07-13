import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const data = await queryOne(
    `UPDATE public_api_keys SET revoked_at = $1, updated_at = $2 WHERE id = $3 RETURNING id, name, scopes`,
    [new Date().toISOString(), new Date().toISOString(), params.id]
  );

  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await recordAuditEvent({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "public_api_key.revoked",
    entity_type: "public_api_key",
    entity_id: params.id,
    metadata: { name: data.name, scopes: data.scopes },
  });

  return NextResponse.json({ ok: true });
}
