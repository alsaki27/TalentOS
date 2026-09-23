// ARCHIVED 2026-09-07 — retired when TalentOS moved to a single shared
// Gmail inbox fed by external forwarding (see Planning MD Files/
// "TalentOS — Single Shared Gmail Inbox Redesign 6 August 2026.md"). A
// forwarded message cannot be replied to from the account it landed in, so
// this route (send a reply via a candidate's own connected Gmail) no
// longer applies. Moved verbatim out of the app/api tree (so it is not
// registered as a live route) - not deleted.
//
// To restore: move this file back to src/app/api/inbox/send/route.ts,
// restore sendGmailMessage from src/lib/integrations/_archived/gmailSendApi.ts
// into gmailApi.ts (or import it from there), and restore the Reply tab in
// src/app/inbox/_archived-components/EmailActionModalReplyDraftTabs.archived.tsx.
// Original path: src/app/api/inbox/send/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { refreshGmailAccessToken } from "@/lib/integrations/gmailApi";
import { sendGmailMessage } from "@/lib/integrations/_archived/gmailSendApi";
import { decryptSecret } from "@/server/security/secretCrypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const { candidate_id, to_email, subject, body: emailBody, reply_to_thread_id, draft_id, attachment_urls } = body;

  if (!candidate_id || !to_email || !subject || !emailBody) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Look up gmail account
  const account = await queryOne<{ refresh_token: string; gmail_email: string }>(
    `SELECT refresh_token, email as gmail_email FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1 AND status != 'revoked'`,
    [candidate_id]
  );

  if (!account || !account.refresh_token) {
    return NextResponse.json({ error: "No Gmail account connected for this candidate" }, { status: 400 });
  }

  const decryptedToken = await decryptSecret(account.refresh_token);
  const { access_token } = await refreshGmailAccessToken(decryptedToken);

  const result = await sendGmailMessage(access_token, {
    to: to_email,
    subject,
    body: emailBody,
    replyToThreadId: reply_to_thread_id,
    attachmentUrls: attachment_urls,
  });

  const commId = await queryOne<{ id: string }>(
    `INSERT INTO email_communications
      (direction, gmail_message_id, gmail_thread_id, candidate_id, from_email, to_emails, subject, body_text, sent_at)
     VALUES ('outbound', $1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
    [result.messageId, result.threadId, candidate_id, account.gmail_email, [to_email], subject, emailBody]
  );

  if (draft_id) {
    await execute(`UPDATE inbox_drafts SET sent_at = now() WHERE id = $1 AND sent_at IS NULL`, [draft_id]);
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "email",
    description: `Sent email to ${to_email} via candidate Gmail`,
    entityType: "candidate",
    entityId: candidate_id,
  });

  return NextResponse.json({ success: true, messageId: result.messageId, threadId: result.threadId, communicationId: commId?.id });
}
