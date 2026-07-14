// src/app/api/inbox/threads/route.ts
// GET -> list candidates with their last message preview and unread count for the inbox sidebar.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const needsReplyFilter = url.searchParams.get("needsReply") === "true";

  let candidates: any[] = [];
  let sql = `SELECT id, name, email, avatar_url FROM candidates`;
  const sqlParams: any[] = [];
  if (search) {
    sql += ` WHERE name ILIKE $1 OR email ILIKE $2`;
    sqlParams.push(`%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY created_at DESC LIMIT 500`;
  candidates = await query<any>(sql, sqlParams);

  const candidateIds = candidates.map((c: any) => c.id as string);
  if (candidateIds.length === 0) return NextResponse.json({ threads: [] });

  let lastMessages: any[] = [];
  let unreadRows: any[] = [];
  let needsReplyRows: any[] = [];
  lastMessages = await query<any>(`SELECT candidate_id, body, created_at FROM candidate_messages WHERE candidate_id::text = ANY($1) ORDER BY created_at DESC`, [candidateIds]);
  unreadRows = await query<any>(`SELECT candidate_id FROM candidate_messages WHERE candidate_id::text = ANY($1) AND direction = 'inbound' AND read_at IS NULL`, [candidateIds]);

  needsReplyRows = await query<any>(
    `SELECT m.candidate_id
     FROM candidate_messages m
     WHERE m.candidate_id::text = ANY($1)
       AND m.direction = 'inbound' AND m.read_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM candidate_messages o
         WHERE o.candidate_id = m.candidate_id
           AND (o.status = 'sent' OR (o.direction = 'outbound' AND o.status IS NULL))
           AND (
             (o.gmail_thread_id IS NOT NULL AND o.gmail_thread_id = m.gmail_thread_id)
             OR (o.gmail_thread_id IS NULL AND m.gmail_thread_id IS NULL AND o.subject = m.subject)
           )
           AND o.created_at > m.created_at
       )
     GROUP BY m.candidate_id`,
    [candidateIds]
  );

  const lastMessageMap: Record<string, { body: string; created_at: string }> = {};
  for (const msg of lastMessages) {
    if (!lastMessageMap[msg.candidate_id]) {
      lastMessageMap[msg.candidate_id] = { body: msg.body, created_at: msg.created_at };
    }
  }

  const unreadMap: Record<string, number> = {};
  for (const row of unreadRows) {
    unreadMap[row.candidate_id] = (unreadMap[row.candidate_id] || 0) + 1;
  }

  const needsReplySet = new Set(needsReplyRows.map((r: any) => r.candidate_id));

  let threads = candidates.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email ?? null,
    avatar_url: c.avatar_url ?? null,
    last_message: lastMessageMap[c.id]?.body ?? null,
    last_message_at: lastMessageMap[c.id]?.created_at ?? null,
    unread_count: unreadMap[c.id] ?? 0,
    needs_reply: needsReplySet.has(c.id),
  }));

  if (needsReplyFilter) {
    threads = threads.filter((t: any) => t.needs_reply);
  }

  return NextResponse.json({ threads });
}
