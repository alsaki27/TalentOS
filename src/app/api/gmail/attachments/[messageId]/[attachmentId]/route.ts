// Proxies a real attachment download from Gmail (messages.attachments.get)
// through the shared mailbox's stored, decrypted token - part of the
// shared-inbox redesign's "read attachments properly, in-app" requirement,
// replacing the old "click through to Gmail" workaround.

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { getDecryptedGmailAccount } from "@/server/repositories/gmailIntegrationRepository";
import { ensureFreshAccessToken } from "@/server/services/gmailSyncService";
import { getAttachment } from "@/lib/integrations/gmailApi";

export const dynamic = "force-dynamic";

interface AttachmentMeta {
  filename?: string;
  mimeType?: string;
  size?: number;
  attachmentId?: string | null;
}

export async function GET(req: NextRequest, { params }: { params: { messageId: string; attachmentId: string } }) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const message = await queryOne<{ integration_account_id: string; attachment_metadata: AttachmentMeta[] }>(
    `SELECT integration_account_id, attachment_metadata FROM email_communications WHERE gmail_message_id = $1`,
    [params.messageId],
  );
  if (!message) return NextResponse.json({ error: "Email not found." }, { status: 404 });

  const meta = (message.attachment_metadata || []).find((a) => a.attachmentId === params.attachmentId);
  if (!meta) return NextResponse.json({ error: "Attachment not found on this email." }, { status: 404 });

  const account = await getDecryptedGmailAccount(message.integration_account_id);
  if (!account) return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken(account);
  } catch {
    return NextResponse.json({ error: "Gmail access is unavailable — reconnect the shared mailbox." }, { status: 502 });
  }

  let attachment: { data: string; size: number };
  try {
    attachment = await getAttachment(accessToken, params.messageId, params.attachmentId);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch attachment from Gmail." }, { status: 502 });
  }

  const bytes = Buffer.from(attachment.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const download = req.nextUrl.searchParams.get("download") === "1";
  const safeFilename = (meta.filename || "attachment").replace(/["\r\n]/g, "");

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": meta.mimeType || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeFilename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
