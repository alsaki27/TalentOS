import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import { refreshGmailAccessToken, createGmailDraft } from "@/lib/integrations/gmailApi";
import { decryptSecret } from "@/server/security/secretCrypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId");
  const threadId = url.searchParams.get("threadId");

  if (!candidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }

  let sql = `SELECT * FROM inbox_drafts WHERE candidate_id = $1 AND sent_at IS NULL AND discarded_at IS NULL`;
  const params: any[] = [candidateId];

  if (threadId) {
    sql += ` AND gmail_thread_id = $2`;
    params.push(threadId);
  }

  sql += ` ORDER BY created_at DESC`;

  const drafts = await query(sql, params);
  return NextResponse.json({ drafts: drafts ?? [] });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const { candidate_id, to_email, subject, body: emailBody, email_communication_id, gmail_thread_id, sync_to_gmail = true } = body;

  if (!candidate_id || !to_email || !subject || !emailBody) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  let gmail_draft_id: string | null = null;
  let returned_thread_id = gmail_thread_id;

  if (sync_to_gmail) {
    const account = await queryOne<{ refresh_token: string }>(
      `SELECT refresh_token FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1 AND status != 'revoked'`,
      [candidate_id]
    );
    if (account && account.refresh_token) {
      try {
        const decryptedToken = await decryptSecret(account.refresh_token);
        const { access_token } = await refreshGmailAccessToken(decryptedToken);
        const draftResult = await createGmailDraft(access_token, {
          to: to_email,
          subject,
          body: emailBody,
          replyToThreadId: gmail_thread_id,
        });
        gmail_draft_id = draftResult.draftId;
        returned_thread_id = draftResult.threadId;
      } catch (err) {
        console.error("Failed to sync draft to Gmail:", err);
      }
    }
  }

  const draft = await queryOne(
    `INSERT INTO inbox_drafts (candidate_id, to_email, subject, body, email_communication_id, gmail_thread_id, gmail_draft_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [candidate_id, to_email, subject, emailBody, email_communication_id ?? null, returned_thread_id ?? null, gmail_draft_id, context.profile.user_id]
  );

  return NextResponse.json(draft);
}

export async function PATCH(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const { id, subject, body: emailBody, to_email } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const draft = await queryOne(`UPDATE inbox_drafts SET subject = COALESCE($1, subject), body = COALESCE($2, body), to_email = COALESCE($3, to_email), updated_at = now() WHERE id = $4 RETURNING *`, [subject, emailBody, to_email, id]);
  return NextResponse.json(draft);
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await execute(`UPDATE inbox_drafts SET discarded_at = now() WHERE id = $1`, [id]);
  return NextResponse.json({ success: true });
}
