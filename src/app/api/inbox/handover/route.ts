import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { createNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

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
      type, title, description, email_communication_id, priority, status, resolution_rule, assigned_to_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      "team_handover",
      `Email handover: ${thread.subject || "(no subject)"}`,
      note || null,
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
