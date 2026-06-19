// src/app/api/application-packets/[id]/route.ts
// GET    -> single packet
// PATCH  -> update any fields
// DELETE -> delete (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("application_packets")
    .select("*, applications(status, review_status, review_note, jobs(title, company))")
    .eq("application_id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = [
    "base_resume_id", "target_job_id", "final_resume_version_id",
    "approved_keyword_ids", "rejected_keyword_ids",
    "cover_letter", "recruiter_message", "hiring_manager_email", "interview_prep_notes",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("application_packets")
    .update(updates)
    .eq("application_id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    if ("final_resume_version_id" in updates) {
      await logActivity({
        userId: context.profile.user_id,
        actorName: context.profile.display_name || context.profile.email || undefined,
        type: "update",
        description: `Attached resume variant to application packet ${params.id}`,
        entityType: "application_packet",
        entityId: params.id,
        metadata: { application_id: params.id, final_resume_version_id: updates.final_resume_version_id },
      });
    }

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated application packet for application ${params.id}`,
      entityType: "application_packet",
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
    .from("application_packets")
    .delete()
    .eq("application_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted application packet for application ${params.id}`,
      entityType: "application_packet",
      entityId: params.id,
    });
  }

  return NextResponse.json({ ok: true });
}
