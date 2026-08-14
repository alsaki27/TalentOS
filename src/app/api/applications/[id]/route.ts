// src/app/api/applications/[id]/route.ts
// PATCH  -> update an application's status/notes
// DELETE -> remove an application (and its status-change history)

import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { queryOne, execute } from "@/server/db/neon";
import {
  findApplicationById,
  updateApplication,
  deleteApplication,
} from "@/server/repositories/applicationsRepository";
import { APPLICATION_STAGES } from "@/lib/applicationStages";

const AE_STAGES = ["in_ai_pipeline", "ready_for_review", "ready_for_application", "applied"] as const;

// Had no GET handler at all (only PATCH/DELETE) - same missing-method pattern
// already found and fixed on the workflow status route. Confirmed live via
// the E2E test's status-poll: "SyntaxError: Unexpected end of JSON input" on
// r.json(), from Next.js's default empty-body 405 for an unmatched method.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const application = await findApplicationById(params.id);
  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  return NextResponse.json(application);
}

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
    // ae_stage is deliberately NOT in assignmentFields below - both AEs and
    // managers can move it, unlike the assignment/review fields it sits next to.
    "ae_stage", "application_stage",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if ("ae_stage" in updates && !AE_STAGES.includes(updates.ae_stage as typeof AE_STAGES[number])) {
    return NextResponse.json({ error: "Invalid AE stage." }, { status: 400 });
  }
  if ("application_stage" in updates && !APPLICATION_STAGES.includes(updates.application_stage as typeof APPLICATION_STAGES[number])) {
    return NextResponse.json({ error: "Invalid application stage." }, { status: 400 });
  }

  // application_stage is the canonical lifecycle field. ae_stage remains a
  // compatibility mirror until the queue and old clients are fully migrated.
  if ("application_stage" in updates && !("ae_stage" in updates)) {
    updates.ae_stage = updates.application_stage;
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
  let previousAeStage: string | null = null;
  let currentApplication: { applied_at: string | null; completed_at: string | null; status: string; review_status: string | null; ae_stage: string } | null = null;
  if ("status" in updates || "ae_stage" in updates) {
    currentApplication = await findApplicationById(params.id);
    previousStatus = currentApplication?.status ?? null;
    previousReviewStatus = currentApplication?.review_status ?? null;
    previousAeStage = currentApplication?.ae_stage ?? null;
  }

  // AE hand-off stage: In AI Pipeline -> Ready for AE Review -> Ready for AE
  // Application -> AE Applied. Anyone touching it (AE or manager - no role
  // gate here, unlike assignmentFields above) gets stamped as the last editor.
  // The reviewer identity is captured separately and persists even after the
  // ticket moves on to "applied", so whoever applies can see who reviewed it.
  if ("ae_stage" in updates && updates.ae_stage !== previousAeStage) {
    updates.application_stage = updates.ae_stage;
    updates.ae_stage_updated_at = new Date().toISOString();
    updates.ae_stage_updated_by_user_id = currentUser.profile.user_id;
    updates.ae_stage_updated_by_name = currentUser.profile.display_name || currentUser.profile.email;

    if (previousAeStage === "ready_for_review" && updates.ae_stage === "ready_for_application") {
      updates.ae_reviewed_by_user_id = currentUser.profile.user_id;
      updates.ae_reviewed_by_name = currentUser.profile.display_name || currentUser.profile.email;
      updates.ae_reviewed_at = new Date().toISOString();
    }

    // Same pattern as the reviewer capture above, for the final hand-off:
    // whoever moves it to "applied" is attributed here, and (like the
    // reviewer field) this is never overwritten by any later transition.
    if (updates.ae_stage === "applied") {
      updates.ae_applied_by_user_id = currentUser.profile.user_id;
      updates.ae_applied_by_name = currentUser.profile.display_name || currentUser.profile.email;
      updates.ae_applied_at = new Date().toISOString();
    }

    // AE Applied is a real lifecycle transition, not only a display label.
    // Keep the legacy status fields synchronized so candidate dashboards,
    // follow-up views, exports, and analytics all see the same truth.
    if (updates.ae_stage === "applied") {
      const appliedAt = currentApplication?.applied_at ?? new Date().toISOString();
      updates.status = "applied";
      updates.applied_at = appliedAt;
      updates.completed_at = currentApplication?.completed_at ?? appliedAt;
    } else if (previousAeStage === "applied") {
      updates.status = "in_progress";
      updates.applied_at = null;
      updates.completed_at = null;
    }

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

  try {
    const data = await updateApplication(params.id, updates);

    if ("ae_stage" in updates && updates.ae_stage !== previousAeStage) {
      await execute(
        'INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_by_user_id, changed_by_name, reason, source) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [params.id, previousAeStage, updates.ae_stage, currentUser.profile.user_id, currentUser.profile.display_name || currentUser.profile.email, body.event_note ?? null, 'queue']
      );
    }

    if ("status" in updates && updates.status !== previousStatus) {
      await execute(
        'INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)',
        [params.id, previousStatus, updates.status, body.event_note ?? ("ae_stage" in updates ? `AE stage moved to ${updates.ae_stage}.` : null)]
      );
    }

    if (currentUser) {
      await execute(
        'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          currentUser.profile.user_id,
          currentUser.profile.email,
          'application.updated',
          'application',
          params.id,
          JSON.stringify({ fields: Object.keys(updates) }),
        ]
      );

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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins, managers, and recruiters can remove assignments." }, { status: 403 });
  }

  try {
    await deleteApplication(params.id);

    if (currentUser) {
      await execute(
        'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)',
        [
          currentUser.profile.user_id,
          currentUser.profile.email,
          'application.deleted',
          'application',
          params.id,
        ]
      );

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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
