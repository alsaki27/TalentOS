// src/app/api/applications/[id]/route.ts
// PATCH  -> update an application's status/notes
// DELETE -> remove an application (and its status-change history)

import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { supabase } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const allowedFields = [
    "status", "notes", "resume_url", "resume_filename", "resume_id",
    "follow_up_at", "follow_up_source", "follow_up_completed_at", "next_action", "assigned_by", "assigned_to",
    "assigned_by_user_id", "assigned_to_user_id",
    "assignment_note", "assignment_due_at", "completed_at",
    "priority", "review_status", "review_note", "reviewed_by_user_id", "reviewed_at",
    "adhoc_job_data", "adhoc_job_raw_text", "source_type",
    "proof_url", "proof_filename", "proof_uploaded_at", "proof_uploaded_by_user_id",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if ("follow_up_at" in updates) {
    if (updates.follow_up_at) {
      updates.follow_up_source = body.follow_up_source ?? "manual";
      updates.follow_up_created_at = new Date().toISOString();
      updates.follow_up_completed_at = null;
    } else {
      updates.follow_up_source = null;
      updates.follow_up_completed_at = new Date().toISOString();
    }
  }

  const assignmentFields = [
    "assigned_by", "assigned_to", "assigned_by_user_id", "assigned_to_user_id",
    "assignment_note", "assignment_due_at", "priority", "reviewed_by_user_id", "reviewed_at",
  ];
  const managerReviewDecision = updates.review_status === "approved" || updates.review_status === "changes_requested";
  const touchesAssignment = assignmentFields.some((field) => field in updates) || managerReviewDecision;
  if (touchesAssignment && !hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins, managers, and recruiters can edit assignments." }, { status: 403 });
  }

  if (updates.review_status === "approved" || updates.review_status === "changes_requested") {
    updates.reviewed_by_user_id = currentUser.profile.user_id;
    updates.reviewed_at = new Date().toISOString();
  }

  if ("proof_url" in updates) {
    updates.proof_uploaded_at = updates.proof_url ? new Date().toISOString() : null;
    updates.proof_uploaded_by_user_id = updates.proof_url ? currentUser.profile.user_id : null;
  }

  let previousStatus: string | null = null;
  let previousReviewStatus: string | null = null;
  if ("status" in updates) {
    const { data: current } = await supabase
      .from("applications")
      .select("status, review_status")
      .eq("id", params.id)
      .single();
    previousStatus = current?.status ?? null;
    previousReviewStatus = current?.review_status ?? null;
  }

  if (updates.status === "applied") {
    const reviewStatus = (updates.review_status ?? previousReviewStatus) as string | null;
    const reviewBlocksApply = reviewStatus === "pending" || reviewStatus === "changes_requested";
    const canOverrideReview = hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES);
    if (reviewBlocksApply && !canOverrideReview) {
      return NextResponse.json(
        { error: "Manager review must be approved before marking this application applied." },
        { status: 409 },
      );
    }
    if (reviewBlocksApply && canOverrideReview) {
      updates.review_status = "approved";
      updates.reviewed_by_user_id = currentUser.profile.user_id;
      updates.reviewed_at = new Date().toISOString();
    }
  }

  if ("status" in updates) {
    const automated = applicationAutomation({
      status: String(updates.status),
      explicitFollowUp: "follow_up_at" in body,
      explicitNextAction: "next_action" in body,
      explicitAssignmentDue: "assignment_due_at" in body,
    });
    for (const [key, value] of Object.entries(automated)) {
      if (!(key in updates)) updates[key] = value;
    }
  }

  const { data, error } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if ("status" in updates && updates.status !== previousStatus) {
    await supabase.from("application_events").insert({
      application_id: params.id,
      from_status: previousStatus,
      to_status: updates.status,
      note: body.event_note ?? null,
    });
  }

  if (currentUser) {
    await supabase.from("audit_logs").insert({
      actor_user_id: currentUser.profile.user_id,
      actor_email: currentUser.profile.email,
      action: "application.updated",
      entity_type: "application",
      entity_id: params.id,
      metadata: { fields: Object.keys(updates) },
    });

    await logActivity({
      userId: currentUser.profile.user_id,
      actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
      type: "update",
      description: `Updated application ${params.id}`,
      entityType: "application",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });
    void triggerWebhooks("application.updated", {
      application_id: params.id,
      updates: Object.keys(updates),
      updated_by: currentUser.profile.user_id,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins, managers, and recruiters can remove assignments." }, { status: 403 });
  }
  const { error } = await supabase.from("applications").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (currentUser) {
    await supabase.from("audit_logs").insert({
      actor_user_id: currentUser.profile.user_id,
      actor_email: currentUser.profile.email,
      action: "application.deleted",
      entity_type: "application",
      entity_id: params.id,
    });

    await logActivity({
      userId: currentUser.profile.user_id,
      actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
      type: "delete",
      description: `Deleted application ${params.id}`,
      entityType: "application",
      entityId: params.id,
    });
    void triggerWebhooks("application.deleted", {
      application_id: params.id,
      deleted_by: currentUser.profile.user_id,
    });
  }
  return NextResponse.json({ ok: true });
}
