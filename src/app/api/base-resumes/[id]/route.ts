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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const { data, error } = await supabase.from("base_resumes").select("*").eq("id", params.id).single();
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

  const { data, error } = await supabase.from("base_resumes").update(updates).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { error } = await supabase.from("base_resumes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
