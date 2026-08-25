import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const hasStatus = body.status !== undefined;
  const hasPriority = body.priority !== undefined;
  if (!hasStatus && !hasPriority) {
    return NextResponse.json({ error: "status or priority is required." }, { status: 400 });
  }

  if (hasPriority) {
    const priority = String(body.priority);
    if (!VALID_PRIORITIES.has(priority)) {
      return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    }
    await execute("UPDATE action_items SET priority = $1 WHERE id = $2", [priority, params.id]);
  }

  const status = hasStatus ? String(body.status) : null;
  if (hasStatus && !VALID_STATUSES.has(status!)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  if (hasStatus) {
    const resolved = status === "done" || status === "dismissed";
    if (resolved) {
      const note = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 4000) : null;
      if (status === "done" && !note) {
        const emailTask = await queryOne<{ email_communication_id: string | null }>("SELECT email_communication_id FROM action_items WHERE id = $1", [params.id]);
        if (emailTask?.email_communication_id) return NextResponse.json({ error: "Add an AE resolution note before closing an email task." }, { status: 400 });
      }
      const resolutionKind = status === "dismissed" ? "dismissed" : (body.takeover ? "manual_takeover" : "manual_resolution");
      await execute(
        "UPDATE action_items SET status = $1, resolved_at = now(), resolved_by_user_id = $2, resolution_note = COALESCE($3, resolution_note), resolution_kind = $4 WHERE id = $5",
        [status, context.profile.user_id, note, resolutionKind, params.id]
      );
    } else if (status === "in_progress") {
      await execute(
        "UPDATE action_items SET status = $1, assigned_to_user_id = $2, taken_over_at = COALESCE(taken_over_at, now()), taken_over_by_user_id = $2, resolution_note = COALESCE($3, resolution_note) WHERE id = $4",
        [status, context.profile.user_id, typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 4000) : null, params.id]
      );
    } else {
      await execute(
        "UPDATE action_items SET status = $1, resolved_at = NULL, resolved_by_user_id = NULL WHERE id = $2",
        [status, params.id]
      );
    }
  }

  const task = await queryOne<{ candidate_id: string; application_id: string | null; email_communication_id: string | null }>(
    "SELECT candidate_id, application_id, email_communication_id FROM action_items WHERE id = $1",
    [params.id]
  );
  if (task) {
    const eventType = hasStatus ? `action_item_${status}` : `action_item_priority_${body.priority}`;
    await execute(
      `INSERT INTO candidate_workflow_events
         (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, actor_user_id, payload)
       VALUES ($1, $2, $3, $4, $5, 'ae', $6, $7)`,
      [task.candidate_id, task.application_id, params.id, task.email_communication_id, eventType, context.profile.user_id, JSON.stringify({ resolution_note: body.resolution_note || null, priority: hasPriority ? body.priority : undefined })]
    );
  }

  return NextResponse.json({ ok: true });
}
