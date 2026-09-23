// src/app/api/webhooks/[id]/route.ts
// PATCH  -> update a webhook endpoint
// DELETE -> remove a webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = ["name", "url", "secret", "events", "status"];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  const data = await queryOne(
    `UPDATE webhook_endpoints SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  const error = data ? null : { message: 'Update failed' };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const res = await execute('DELETE FROM webhook_endpoints WHERE id = $1', [params.id]);
  const error = res.rowCount === 0 ? { message: 'Not found' } : null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
