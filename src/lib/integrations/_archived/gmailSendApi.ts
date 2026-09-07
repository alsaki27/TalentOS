// ARCHIVED 2026-09-07 — retired when TalentOS moved to a single shared
// Gmail inbox fed by external forwarding (see Planning MD Files/
// "TalentOS — Single Shared Gmail Inbox Redesign 6 August 2026.md"). A
// forwarded message cannot be replied to from the account it landed in, so
// send/draft capability no longer applies. This file is fully working code,
// moved verbatim out of src/lib/integrations/gmailApi.ts, just not wired
// into any active route/import today.
//
// To restore: move buildRawEmail/sendGmailMessage/createGmailDraft and the
// three interfaces below back into gmailApi.ts (or leave them here and
// import from this path instead), then restore the archived callers:
// src/server/services/_archived/inboxSendRoute.ts and
// src/server/services/_archived/inboxDraftsRoute.ts (see their own header
// comments), and the Reply/Draft tabs in
// src/app/inbox/_archived-components/EmailActionModalReplyDraftTabs.archived.tsx.
// Original path of everything below: src/lib/integrations/gmailApi.ts

import { gmailFetch } from "@/lib/integrations/gmailApi";

export interface GmailSendOptions {
  to: string;
  subject: string;
  body: string;
  replyToThreadId?: string | null;
  attachmentUrls?: string[];
}

export interface GmailSendResult {
  messageId: string;
  threadId: string;
}

export interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

function buildRawEmail(opts: GmailSendOptions): string {
  const lines: string[] = [];
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${opts.subject}`);

  if (opts.replyToThreadId) {
    // Gmail uses In-Reply-To and References, but providing just threadId in the request body
    // is sufficient for the Gmail API to thread it correctly. However, adding basic headers doesn't hurt.
  }

  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body);

  const raw = lines.join("\r\n");

  // base64url encode
  if (typeof btoa !== 'undefined') {
    return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else {
    return Buffer.from(raw, 'utf8').toString('base64url');
  }
}

export async function sendGmailMessage(accessToken: string, opts: GmailSendOptions): Promise<GmailSendResult> {
  const raw = buildRawEmail(opts);
  const bodyPayload: any = { raw };
  if (opts.replyToThreadId) {
    bodyPayload.threadId = opts.replyToThreadId;
  }

  const res = await gmailFetch("/messages/send", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });

  const data = await res.json();
  return {
    messageId: data.id,
    threadId: data.threadId,
  };
}

export async function createGmailDraft(accessToken: string, opts: GmailSendOptions): Promise<GmailDraftResult> {
  const raw = buildRawEmail(opts);
  const bodyPayload: any = { message: { raw } };
  if (opts.replyToThreadId) {
    bodyPayload.message.threadId = opts.replyToThreadId;
  }

  const res = await gmailFetch("/drafts", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });

  const data = await res.json();
  return {
    draftId: data.id,
    messageId: data.message.id,
    threadId: data.message.threadId,
  };
}
