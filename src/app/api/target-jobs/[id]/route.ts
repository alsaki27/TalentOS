// src/app/api/target-jobs/[id]/route.ts
// GET    -> single target job with job_keywords joined
// PATCH  -> update any fields
// DELETE -> delete target job (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { findTargetJobById, updateTargetJob, deleteTargetJob } from "@/server/repositories/targetJobsRepository";
import { logActivity } from "@/lib/activity";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const data = await findTargetJobById(params.id);

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const data = await updateTargetJob(params.id, updates);

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

  const existing = await findTargetJobById(params.id);

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteTargetJob(params.id);

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
