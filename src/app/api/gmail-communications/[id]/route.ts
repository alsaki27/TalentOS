import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const message = await queryOne<any>(
    `SELECT ec.id, ec.candidate_id, c.name AS candidate_name, c.email AS candidate_email,
            ec.integration_account_id, ec.gmail_message_id, ec.gmail_thread_id,
            ec.direction, ec.from_email, ec.to_emails, ec.subject, ec.snippet,
            ec.body_text, ec.sent_at, ec.ingested_at, ec.ai_relevant, ec.ai_category,
            ec.ai_confidence, ec.ai_summary, ec.ai_matched_application_id,
            ec.needs_reply, ec.replied_at, ec.triaged_at, ec.gmail_label_ids,
            ec.gmail_is_unread, ec.gmail_is_important, ec.attachment_metadata, ec.interview_details, ec.ai_evidence,
            a.status AS application_status, a.application_stage,
            j.id AS job_id, j.title AS job_title, j.company AS company_name,
            c.portal_token,
            (SELECT arv.id FROM application_resume_versions arv
              WHERE arv.application_id = ec.ai_matched_application_id
              ORDER BY arv.created_at DESC LIMIT 1) AS resume_version_id
       FROM email_communications ec
       JOIN candidates c ON c.id = ec.candidate_id
       LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
       LEFT JOIN jobs j ON j.id = a.job_id
      WHERE ec.id = $1`,
    [params.id],
  );
  if (!message) return NextResponse.json({ error: "Email not found." }, { status: 404 });

  const thread = await query<any>(
    `SELECT ec.id, ec.direction, ec.from_email, ec.to_emails, ec.subject,
            ec.body_text, ec.snippet, ec.sent_at, ec.ai_relevant, ec.ai_category,
            ec.ai_confidence, ec.ai_summary, ec.needs_reply, ec.replied_at,
            ec.triaged_at, ec.gmail_label_ids, ec.gmail_is_unread,
            ec.gmail_is_important, ec.attachment_metadata, ec.interview_details, ec.ai_evidence
       FROM email_communications ec
      WHERE ec.candidate_id = $1 AND ec.gmail_thread_id = $2
      ORDER BY ec.sent_at ASC, ec.id ASC`,
    [message.candidate_id, message.gmail_thread_id],
  );

  const actionItems = await query<any>(
    `SELECT id, type, title, description, suggested_action, priority, status,
            resolution_rule, resolution_kind, resolution_note, due_at,
            resolved_at, created_at,
            proposed_status, proposed_from_status, ai_confidence, decision, decided_at
       FROM action_items
      WHERE email_communication_id IN (SELECT id FROM email_communications WHERE candidate_id = $1 AND gmail_thread_id = $2)
      ORDER BY created_at DESC`,
    [message.candidate_id, message.gmail_thread_id],
  );

  return NextResponse.json({
    message,
    thread,
    actionItems,
    gmailUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.gmail_thread_id)}`,
  });
}
