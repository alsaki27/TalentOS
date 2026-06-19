// src/app/api/target-jobs/[id]/route.ts
// GET    -> single target job with job_keywords joined
// PATCH  -> update any fields
// DELETE -> delete target job (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("target_jobs")
    .select("*, job_keywords(*)")
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
    "raw_description", "parsed_description", "fit_score", "recommendation",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("target_jobs")
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
      description: `Updated target job ${params.id}`,
      entityType: "target_job",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { data: existing } = await supabase
    .from("target_jobs")
    .select("id")
    .eq("id", params.id)
    .single();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase.from("target_jobs").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted target job ${params.id}`,
      entityType: "target_job",
      entityId: params.id,
    });
  }

  return NextResponse.json({ ok: true });
}
