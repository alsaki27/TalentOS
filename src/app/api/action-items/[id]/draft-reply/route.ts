import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { draftRecruiterReply } from "@/lib/ai/emailReplyDraft";
import { execute } from "@/server/db/neon";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  const task = await queryOne<any>(
    `SELECT ai.id, ai.candidate_id, ai.email_communication_id, c.name AS candidate_name,
            ec.subject, ec.body_text, ec.ai_summary, j.title AS job_title, j.company
     FROM action_items ai
     JOIN candidates c ON c.id = ai.candidate_id
     LEFT JOIN email_communications ec ON ec.id = ai.email_communication_id
     LEFT JOIN applications a ON a.id = ai.application_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE ai.id = $1`,
    [params.id]
  );
  if (!task?.email_communication_id) return NextResponse.json({ error: "This task has no source email." }, { status: 400 });
  const draft = await draftRecruiterReply({ candidateName: task.candidate_name, jobTitle: task.job_title, company: task.company, subject: task.subject, emailBody: task.body_text || "", summary: task.ai_summary });
  const saved = await queryOne<any>(
    `INSERT INTO candidate_email_drafts (candidate_id, action_item_id, email_communication_id, subject, body_text, ai_confidence, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, subject, body_text, ai_confidence, created_at`,
    [task.candidate_id, task.id, task.email_communication_id, draft.subject, draft.body, draft.confidence, context!.profile.user_id]
  );
  await execute("INSERT INTO candidate_workflow_events (candidate_id, action_item_id, email_communication_id, event_type, actor_type, actor_user_id, payload) VALUES ($1, $2, $3, 'reply_draft_created', 'ai', $4, $5)", [task.candidate_id, task.id, task.email_communication_id, context!.profile.user_id, JSON.stringify({ confidence: draft.confidence })]);
  return NextResponse.json({ draft: saved });
}
