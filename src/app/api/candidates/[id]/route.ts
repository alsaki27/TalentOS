// src/app/api/candidates/[id]/route.ts
// GET    -> candidate profile + their applications (with job info joined)
// PATCH  -> update candidate fields (incl. resume_url after upload)
// DELETE -> remove a candidate (cascades to their applications + resume variants)

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { supabase } from "@/lib/supabase";
import { deleteStorageFile } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: candidate, error: candErr } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", params.id)
    .single();

  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 404 });

  // Pull applications for this candidate, joined with job details.
  const { data: applications, error: appErr } = await supabase
    .from("applications")
    .select("*, jobs(id, title, company, location, role_tier)")
    .eq("candidate_id", params.id)
    .order("applied_at", { ascending: false });

  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });

  const { data: resumes, error: resErr } = await supabase
    .from("resumes")
    .select("*")
    .eq("candidate_id", params.id)
    .order("created_at", { ascending: false });

  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

  return NextResponse.json({ ...candidate, applications, resumes });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  const allowedFields = [
    "name", "email", "phone", "status", "target_tier",
    "notes", "resume_url", "resume_filename",
    "target_roles", "preferred_locations", "salary_expectation", "work_authorization",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("candidates")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context && data) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email,
      type: "update",
      description: `Updated candidate ${data.name}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: data.name,
      metadata: { fields: Object.keys(updates) },
    });
    void triggerWebhooks("candidate.updated", {
      candidate_id: params.id,
      updates: Object.keys(updates),
      updated_by: context.profile.user_id,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const [{ data: candidate }, { data: resumes }] = await Promise.all([
    supabase.from("candidates").select("resume_url, avatar_url, name").eq("id", params.id).single(),
    supabase.from("resumes").select("file_url").eq("candidate_id", params.id),
  ]);

  const { error } = await supabase.from("candidates").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all([
    deleteStorageFile(candidate?.resume_url),
    deleteStorageFile(candidate?.avatar_url),
    ...(resumes ?? []).map((r) => deleteStorageFile(r.file_url)),
  ]);

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email,
      type: "delete",
      description: `Deleted candidate ${candidate?.name || params.id}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: candidate?.name || undefined,
    });
    void triggerWebhooks("candidate.deleted", {
      candidate_id: params.id,
      name: candidate?.name || null,
      deleted_by: context.profile.user_id,
    });
  }

  return NextResponse.json({ ok: true });
}
