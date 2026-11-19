import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const isAdmin = context.profile.role === "admin";

  const data = await queryOne(
    `UPDATE public_api_keys
        SET revoked_at = $1, updated_at = $1
      WHERE id = $2 AND ($3::boolean OR created_by_user_id = $4)
      RETURNING id, name, scopes`,
    [new Date().toISOString(), params.id, isAdmin, context.profile.user_id]
  );

  if (!data) return NextResponse.json({ error: "API key not found." }, { status: 404 });

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
