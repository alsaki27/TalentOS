// src/app/api/base-resumes/[id]/route.ts
// GET    -> single base resume (full content)
// PATCH  -> manual edits: name/target_industry/target_roles/status, or a direct
//           content edit (the human typing in the editor, not an AI-proposed change —
//           those go through apply-draft below so the conversation log stays accurate
//           about which edits were AI-proposed vs human-typed).
// DELETE -> remove (e.g. archived/unused draft)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne('SELECT * FROM base_resumes WHERE id = $1', [params.id]);
    error = data ? null : { message: 'Not found' };
  } else {
    const res = await supabase.from("base_resumes").select("*").eq("id", params.id).single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = ["name", "target_industry", "target_roles", "status", "content", "style_id"];
  const updates: Record<string, unknown> = { updated_by: context!.profile.user_id, updated_at: new Date().toISOString() };
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }
  if (body.status === "approved") updates.approved_by = context!.profile.user_id;

  let data: any;
  let error: any;

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
    data = await queryOne(
      `UPDATE base_resumes SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    error = data ? null : { message: 'Update failed' };
  } else {
    const res = await supabase.from("base_resumes").update(updates).eq("id", params.id).select().single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  let error: any;

  if (isNeon()) {
    const res = await execute('DELETE FROM base_resumes WHERE id = $1', [params.id]);
    error = res.rowCount === 0 ? { message: 'Not found' } : null;
  } else {
    const res = await supabase.from("base_resumes").delete().eq("id", params.id);
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
