// src/app/api/import-sources/[id]/route.ts
// PATCH  -> toggle active / edit a saved import source
// DELETE -> remove one

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = ["label", "token_or_url", "is_active"];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  const data = await queryOne(
    `UPDATE import_sources SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  const error = data ? null : { message: 'Update failed' };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const res = await execute('DELETE FROM import_sources WHERE id = $1', [params.id]);
  const error = res.rowCount === 0 ? { message: 'Not found' } : null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
