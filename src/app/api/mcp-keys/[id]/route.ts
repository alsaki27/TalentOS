import { NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { execute } from "@/server/db/neon";
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  await execute("UPDATE mcp_api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [params.id]);
  return NextResponse.json({ revoked: true });
}
