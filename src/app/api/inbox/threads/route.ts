// src/app/api/inbox/threads/route.ts
// GET -> list candidates with their last message preview and unread count for the inbox sidebar.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  let candidates: any[] = [];
  if (isNeon()) {
    let sql = `SELECT id, name, email, avatar_url FROM candidates`;
    const sqlParams: any[] = [];
    if (search) {
      sql += ` WHERE name ILIKE $1 OR email ILIKE $2`;
      sqlParams.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT 500`;
    candidates = await query<any>(sql, sqlParams);
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("candidates")
      .select("id, name, email, avatar_url")
      .order("created_at", { ascending: false })
      .limit(500);

    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    candidates = data ?? [];
  }

  const candidateIds = candidates.map((c: any) => c.id as string);
  if (candidateIds.length === 0) return NextResponse.json({ threads: [] });

  let lastMessages: any[] = [];
  let unreadRows: any[] = [];
  if (isNeon()) {
    lastMessages = await query<any>(`SELECT candidate_id, body, created_at FROM candidate_messages WHERE candidate_id::text = ANY($1) ORDER BY created_at DESC`, [candidateIds]);
    unreadRows = await query<any>(`SELECT candidate_id FROM candidate_messages WHERE candidate_id::text = ANY($1) AND direction = 'inbound' AND read_at IS NULL`, [candidateIds]);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const [{ data: lastMessagesData }, { data: unreadRowsData }] = await Promise.all([
      supabase
        .from("candidate_messages")
        .select("candidate_id, body, created_at")
        .in("candidate_id", candidateIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("candidate_messages")
        .select("candidate_id")
        .in("candidate_id", candidateIds)
        .eq("direction", "inbound")
        .is("read_at", null),
    ]);
    lastMessages = lastMessagesData ?? [];
    unreadRows = unreadRowsData ?? [];
  }

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

  const threads = candidates.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email ?? null,
    avatar_url: c.avatar_url ?? null,
    last_message: lastMessageMap[c.id]?.body ?? null,
    last_message_at: lastMessageMap[c.id]?.created_at ?? null,
    unread_count: unreadMap[c.id] ?? 0,
  }));

  return NextResponse.json({ threads });
}
