import { queryOne, execute } from "@/server/db/neon";
import { refreshIfNeeded, sendMessage, IntegrationAccountRow } from "@/lib/integrations/gmailClient";
import { hasGmailSendScope } from "@/lib/integrations/googleGmail";
import { logActivity } from "@/lib/activity";

export async function sendApprovedDraft(messageId: string): Promise<{
  sent: boolean;
  gmailMessageId?: string;
  gmailThreadId?: string;
  needsReconnect?: boolean;
  email?: string | null;
  error?: string;
}> {
  const message = await queryOne<Record<string, any>>(
    `SELECT cm.*, c.name AS candidate_name
     FROM candidate_messages cm
     JOIN candidates c ON cm.candidate_id = c.id
     WHERE cm.id = $1 AND cm.status = 'approved'`,
    [messageId]
  );

  if (!message) {
    return { sent: false, error: "Draft not found or not approved" };
  }

  const account = await queryOne<IntegrationAccountRow>(
    `SELECT id, candidate_id, email, access_token, refresh_token, token_expires_at, scopes, metadata
     FROM integration_accounts
     WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1 AND status = 'active'
     LIMIT 1`,
    [message.candidate_id]
  );

  if (!account) {
    return { sent: false, error: "Candidate has no connected Gmail account" };
  }

  if (!hasGmailSendScope(account.scopes)) {
    return {
      sent: false,
      needsReconnect: true,
      email: account.email,
      error: "Candidate must re-connect Gmail to grant send permission",
    };
  }

  const accessToken = await refreshIfNeeded(account);

  const rfc822 = buildRfc822({
    from: account.email || undefined,
    to: message.to_address,
    cc: message.cc_address,
    subject: message.subject,
    body: message.body,
    inReplyTo: message.in_reply_to,
    references: message.references_header,
    inReplyToGmailMessageId: message.in_reply_to,
  });

  const rawBase64url = utf8ToBase64url(rfc822);
  const result = await sendMessage(accessToken, rawBase64url);

  await execute(
    `UPDATE candidate_messages
     SET status = 'sent',
         sent_via_gmail_message_id = $2,
         gmail_thread_id = COALESCE(gmail_thread_id, $3),
         direction = 'outbound'
     WHERE id = $1`,
    [messageId, result.id, result.threadId]
  );

  await logActivity({
    userId: message.approved_by ?? undefined,
    type: "email_sent",
    description: `Sent approved draft via Gmail for candidate ${message.candidate_name}`,
    entityType: "candidate_message",
    entityId: messageId,
  });

  return {
    sent: true,
    gmailMessageId: result.id,
    gmailThreadId: result.threadId,
  };
}

function buildRfc822(params: {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  references?: string;
  inReplyToGmailMessageId?: string;
}): string {
  const lines: string[] = [];

  if (params.from) lines.push(`From: ${params.from}`);
  if (params.to) lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);

  let subject = params.subject || "";
  if (params.inReplyTo && !subject.toLowerCase().startsWith("re:")) {
    subject = `Re: ${subject}`;
  }
  lines.push(`Subject: ${subject}`);

  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 7bit`);

  let references = params.references || "";
  if (params.inReplyToGmailMessageId) {
    lines.push(`In-Reply-To: <${params.inReplyToGmailMessageId}>`);
    if (references) references += " ";
    references += `<${params.inReplyToGmailMessageId}>`;
  }
  if (references) lines.push(`References: ${references}`);

  lines.push(""); // empty line separates headers from body
  lines.push(params.body || "");

  return lines.join("\r\n");
}

function utf8ToBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
