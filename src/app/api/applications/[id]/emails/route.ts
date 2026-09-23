import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await query<Record<string, unknown>>(
    `SELECT ec.id, ec.gmail_message_id, ec.gmail_thread_id, ec.direction,
            ec.from_email, ec.to_emails, ec.subject, ec.snippet, ec.body_text,
            ec.sent_at, ec.gmail_label_ids, ec.gmail_is_unread,
            ec.ai_category, ec.ai_confidence, ael.match_method,
            ael.match_confidence, ael.created_at AS linked_at
       FROM application_email_links ael
       JOIN email_communications ec ON ec.id = ael.email_communication_id
      WHERE ael.application_id = $1
      ORDER BY ec.sent_at DESC NULLS LAST, ec.id DESC
      LIMIT 200`,
    [params.id],
  );
  return NextResponse.json(rows);
}
