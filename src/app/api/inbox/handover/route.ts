import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { createNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Bonus fix (shared-inbox redesign pass): the "My Handovers" tab and its
// "Mark Done" button on /inbox have always called GET/PATCH here, but
// neither handler existed - confirmed dead, always rendering an empty list.
// Kept the Team-tab creation flow (POST, below) exactly as-is and added the
// two missing handlers so the feature works as it was clearly meant to.
const VALID_HANDOVER_STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);

export async function GET(_req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const handovers = await query<any>(
    `SELECT ai.id, ai.title, ai.description, ai.priority, ai.status, ai.created_at, ai.due_at,
            ai.candidate_id, c.name AS candidate_name, ai.email_communication_id
       FROM action_items ai
       LEFT JOIN candidates c ON c.id = ai.candidate_id
      WHERE ai.type = 'team_handover' AND ai.assigned_to_user_id = $1
      ORDER BY (ai.status IN ('open', 'in_progress')) DESC, ai.created_at DESC
      LIMIT 200`,
    [context.profile.user_id],
  );

  return NextResponse.json({ handovers });
}

export async function PATCH(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !VALID_HANDOVER_STATUSES.has(status)) {
    return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
  }

  const handover = await queryOne<{ id: string; candidate_id: string }>(
    `SELECT id, candidate_id FROM action_items WHERE id = $1 AND type = 'team_handover' AND assigned_to_user_id = $2`,
    [id, context.profile.user_id],
  );
  if (!handover) return NextResponse.json({ error: "Handover not found." }, { status: 404 });

  const resolved = status === "done" || status === "dismissed";
  await execute(
    resolved
      ? `UPDATE action_items SET status = $1, resolved_at = now(), resolved_by_user_id = $2 WHERE id = $3`
      : `UPDATE action_items SET status = $1 WHERE id = $2`,
    resolved ? [status, context.profile.user_id, id] : [status, id],
  );

  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const { email_communication_id, assignee_user_id, note, priority } = body;

  if (!email_communication_id || !assignee_user_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const thread = await queryOne<{ candidate_id: string; subject: string; gmail_thread_id: string }>(
    `SELECT candidate_id, subject, gmail_thread_id FROM email_communications WHERE id = $1`,
    [email_communication_id]
  );

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const actionItem = await queryOne<{ id: string }>(
    `INSERT INTO action_items (
      type, title, description, candidate_id, email_communication_id, priority, status, resolution_rule, assigned_to_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      "team_handover",
      `Email handover: ${thread.subject || "(no subject)"}`,
      note || null,
      thread.candidate_id,
      email_communication_id,
      priority || "normal",
      "open",
      "manual_only",
      assignee_user_id
    ]
  );

  await createNotification({
    userId: assignee_user_id,
    type: "handover",
    title: "Email assigned to you",
    body: `Re: ${thread.subject || "(no subject)"}`,
    link: `/inbox?candidateId=${thread.candidate_id}`,
  });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "handover",
    description: `Assigned email thread to user ${assignee_user_id}`,
    entityType: "candidate",
    entityId: thread.candidate_id,
  });

  return NextResponse.json({ success: true, action_item_id: actionItem?.id });
}
