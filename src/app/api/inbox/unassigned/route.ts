// The "Unassigned" queue: messages the shared mailbox received that
// candidateEmailMatcher.ts could not deterministically resolve to one
// candidate (see Planning MD Files/"TalentOS — Single Shared Gmail Inbox
// Redesign 6 August 2026.md"). GET lists them; POST assigns one to a
// candidate and, per the plan, back-fills every other still-unassigned
// message already in the same Gmail thread in the same write - so one
// manual match resolves the whole conversation, not just this message.

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { getDecryptedGmailAccount, listActiveSharedGmailAccount } from "@/server/repositories/gmailIntegrationRepository";
import { ensureFreshAccessToken, triageStoredMessage } from "@/server/services/gmailSyncService";

export const dynamic = "force-dynamic";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));

  const count = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM email_communications WHERE candidate_id IS NULL AND direction = 'inbound'`,
  );
  const total = Number(count?.total || 0);

  const messages = await query<any>(
    `SELECT id, gmail_thread_id, gmail_message_id, from_email, to_emails, subject, snippet, sent_at, attachment_metadata
       FROM email_communications
      WHERE candidate_id IS NULL AND direction = 'inbound'
      ORDER BY sent_at DESC, id DESC
      OFFSET $1 LIMIT $2`,
    [(page - 1) * pageSize, pageSize],
  );

  return NextResponse.json({ messages, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const body = await req.json();
  const id = String(body.id || "");
  const candidateId = String(body.candidateId || "");
  if (!isUuid(id) || !isUuid(candidateId)) {
    return NextResponse.json({ error: "id and candidateId (both UUIDs) are required." }, { status: 400 });
  }

  const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id = $1", [candidateId]);
  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });

  const target = await queryOne<{ id: string; gmail_thread_id: string }>(
    `SELECT id, gmail_thread_id FROM email_communications WHERE id = $1 AND candidate_id IS NULL`,
    [id],
  );
  if (!target) return NextResponse.json({ error: "Message not found, or already assigned." }, { status: 404 });

  // One write resolves the target message and every other still-unassigned
  // message already in the same thread - the point of thread continuity
  // (candidateEmailMatcher.ts tier 1) is that this only has to happen once
  // per conversation, not once per message in it.
  const backfilled = await query<{ id: string }>(
    `UPDATE email_communications
        SET candidate_id = $1, candidate_match_method = 'manual'
      WHERE gmail_thread_id = $2 AND candidate_id IS NULL
      RETURNING id`,
    [candidateId, target.gmail_thread_id],
  );

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "email",
    description: `Manually assigned ${backfilled.length} unassigned email(s) in a thread to a candidate`,
    entityType: "candidate",
    entityId: candidateId,
  });

  // Best-effort: trigger triage immediately instead of waiting for the next
  // scheduled sync's backlog sweep. A failure here is not user-facing - the
  // next sync run retries every row whose triaged_at is still NULL.
  try {
    const sharedAccount = await listActiveSharedGmailAccount(true);
    if (sharedAccount) {
      const account = await getDecryptedGmailAccount(sharedAccount.id);
      if (account) {
        const accessToken = await ensureFreshAccessToken(account);
        for (const row of backfilled) {
          try { await triageStoredMessage(row.id, accessToken); } catch { /* retried by the next sync run */ }
        }
      }
    }
  } catch { /* retried by the next sync run */ }

  return NextResponse.json({ success: true, assignedCount: backfilled.length });
}
