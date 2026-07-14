import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { requireCandidateByToken } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const messages = await query<Record<string, any>>(
    `SELECT id, direction, channel, subject, body, sender_name, from_address,
            to_address, gmail_thread_id, created_at
     FROM candidate_messages
     WHERE candidate_id = $1
       AND (direction = 'inbound' OR status = 'sent')
     ORDER BY created_at DESC
     LIMIT 200`,
    [candidate.id]
  );

  const threads = new Map<string, Record<string, any>[]>();
  for (const msg of messages) {
    const threadKey = msg.gmail_thread_id || msg.subject || "no-thread";
    const list = threads.get(threadKey) || [];
    list.push(msg);
    threads.set(threadKey, list);
  }

  const result = Array.from(threads.entries()).map(([threadId, msgs]) => ({
    threadId,
    subject: msgs[0]?.subject ?? null,
    lastActivityAt: msgs[0]?.created_at ?? null,
    messages: msgs.reverse(),
  }));

  result.sort((a, b) => {
    const aDate = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bDate = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return bDate - aDate;
  });

  return NextResponse.json({ threads: result });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const body = await req.json().catch(() => null);
  if (!body || !body.body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  let parentMessage: Record<string, any> | null = null;
  if (body.inReplyToMessageId) {
    parentMessage = await queryOne<Record<string, any>>(
      `SELECT id, subject, from_address, to_address, gmail_message_id, gmail_thread_id,
              in_reply_to, references_header
       FROM candidate_messages
       WHERE id = $1 AND candidate_id = $2 AND direction = 'inbound'`,
      [body.inReplyToMessageId, candidate.id]
    );

    if (!parentMessage) {
      return NextResponse.json(
        { error: "Referenced message not found or not accessible" },
        { status: 404 }
      );
    }
  }

  const subject = parentMessage
    ? parentMessage.subject || null
    : body.subject || null;

  const draft = await queryOne<Record<string, any>>(
    `INSERT INTO candidate_messages
       (candidate_id, direction, channel, subject, body, status,
        sender_id, sender_name, to_address, in_reply_to,
        gmail_thread_id, references_header)
     VALUES ($1, 'outbound', 'email', $2, $3, 'pending_approval',
             $4, $5, $6, $7, $8, $9)
     RETURNING id, status`,
    [
      candidate.id,
      subject,
      body.body.trim(),
      candidate.id,
      candidate.name,
      parentMessage?.from_address ?? body.toAddress ?? null,
      parentMessage?.gmail_message_id ?? null,
      parentMessage?.gmail_thread_id ?? null,
      parentMessage?.references_header ?? null,
    ]
  );

  return NextResponse.json(
    { id: draft?.id, status: draft?.status },
    { status: 201 }
  );
}
