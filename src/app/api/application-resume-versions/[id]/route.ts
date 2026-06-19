// src/app/api/application-resume-versions/[id]/route.ts
// GET    -> single with full content
// PATCH  -> update content, formatting, status, ats_score, truth_score, one_page_fit_score
// DELETE -> delete (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = [
    "content", "formatting", "status", "ats_score", "truth_score", "one_page_fit_score",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("application_resume_versions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated application resume version ${params.id}`,
      entityType: "application_resume_version",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { error } = await supabase
    .from("application_resume_versions")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted application resume version ${params.id}`,
      entityType: "application_resume_version",
      entityId: params.id,
    });
  }

  return NextResponse.json({ ok: true });
}
