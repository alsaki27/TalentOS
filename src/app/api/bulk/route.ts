import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { execute, queryOne } from "@/server/db/neon";
import {
  findApplicationById,
  updateApplication,
} from "@/server/repositories/applicationsRepository";

const BULK_APPLICATION_FIELDS = new Set([
  "status",
  "completed_at",
  "assigned_to_user_id",
  "assigned_to",
  "assigned_by",
  "assigned_by_user_id",
  "assignment_note",
  "assignment_due_at",
  "priority",
  "review_status",
  "review_note",
  "next_action",
  "follow_up_at",
  "follow_up_source",
  "follow_up_completed_at",
]);

type BulkBody = {
  action?: string;
  table?: string;
  ids?: unknown;
  updateData?: Record<string, unknown>;
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return errorResponse("Authentication required", 401);
  if (!hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return errorResponse("Only admins, managers, and recruiters can bulk update assignments.", 403);
  }

  let body: BulkBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (body.action !== "PATCH" || body.table !== "applications") {
    return errorResponse("Only PATCH bulk updates for applications are supported.", 400);
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
    : [];
  if (ids.length === 0) return errorResponse("At least one application id is required.", 400);
  if (ids.length > 500) return errorResponse("Bulk updates are limited to 500 applications.", 400);

  const input = body.updateData && typeof body.updateData === "object" ? body.updateData : null;
  if (!input) return errorResponse("updateData is required.", 400);

  const unknownFields = Object.keys(input).filter((field) => !BULK_APPLICATION_FIELDS.has(field));
  if (unknownFields.length > 0) {
    return errorResponse(`Unsupported bulk fields: ${unknownFields.join(", ")}`, 400);
  }

  const updates: Record<string, unknown> = { ...input };
  const isReassignment = "assigned_to_user_id" in updates || "assigned_to" in updates;
  let ownerLabel: string | null = null;

  if ("assigned_to_user_id" in updates) {
    const ownerId = updates.assigned_to_user_id;
    if (ownerId !== null && typeof ownerId !== "string") {
      return errorResponse("assigned_to_user_id must be a user id or null.", 400);
    }

    if (ownerId) {
      const owner = await queryOne<{ user_id: string; display_name: string | null; email: string | null; is_active: boolean }>(
        "SELECT user_id, display_name, email, is_active FROM profiles WHERE user_id = $1",
        [ownerId]
      );
      if (!owner || !owner.is_active) return errorResponse("Selected owner is not an active user.", 400);
      ownerLabel = owner.display_name || owner.email || owner.user_id;
      // The canonical display label is resolved server-side. This prevents a
      // stale or forged client label from disagreeing with the user id.
      updates.assigned_to = ownerLabel;
    } else {
      updates.assigned_to = null;
    }

    updates.assigned_by_user_id = currentUser.profile.user_id;
    updates.assigned_by = currentUser.profile.display_name || currentUser.profile.email;
  }

  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of ids) {
    try {
      const current = await findApplicationById(id);
      if (!current) {
        failed.push({ id, error: "Application not found" });
        continue;
      }

      const rowUpdates: Record<string, unknown> = { ...updates };
      if ("status" in rowUpdates) {
        const automation = applicationAutomation({
          status: String(rowUpdates.status),
          explicitFollowUp: "follow_up_at" in rowUpdates,
          explicitNextAction: "next_action" in rowUpdates,
          explicitAssignmentDue: "assignment_due_at" in rowUpdates,
        });
        for (const [key, value] of Object.entries(automation)) {
          if (!(key in rowUpdates)) rowUpdates[key] = value;
        }
      }

      await updateApplication(id, rowUpdates as any);

      if ("status" in rowUpdates && rowUpdates.status !== current.status) {
        await execute(
          "INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)",
          [id, current.status, rowUpdates.status, isReassignment ? `Bulk reassignment${ownerLabel ? ` to ${ownerLabel}` : ""}.` : "Bulk status update."]
        );
      }

      await execute(
        "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          currentUser.profile.user_id,
          currentUser.profile.email,
          isReassignment ? "application.reassigned" : "application.bulk_updated",
          "application",
          id,
          JSON.stringify({ fields: Object.keys(rowUpdates), bulk: true, owner_id: rowUpdates.assigned_to_user_id ?? null }),
        ]
      );

      updated.push(id);
    } catch (error: any) {
      failed.push({ id, error: error?.message || "Update failed" });
    }
  }

  const status = failed.length > 0 ? (updated.length > 0 ? 207 : 500) : 200;
  return NextResponse.json({
    ok: failed.length === 0,
    updated: updated.length,
    failed: failed.length,
    updatedIds: updated,
    failures: failed,
  }, { status });
}
