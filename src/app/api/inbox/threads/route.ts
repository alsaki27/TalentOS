// src/app/api/inbox/threads/route.ts
// GET -> list candidates with their last message preview and unread count for the inbox sidebar.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");

  // Fetch candidates with last message info via a Supabase RPC or raw query.
  // Since we can't easily do a lateral join in standard Supabase JS, we fetch candidates
  // and then enrich with their latest message and unread count in two queries.

  let query = supabase
    .from("candidates")
    .select("id, name, email, avatar_url")
    .order("created_at", { ascending: false })
    .limit(500);

  if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

  const { data: candidates, error: candErr } = await query;
  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 500 });

  const candidateIds = (candidates ?? []).map((c) => c.id);
  if (candidateIds.length === 0) return NextResponse.json({ threads: [] });

  // Fetch latest message per candidate
  const { data: lastMessages } = await supabase
    .from("candidate_messages")
    .select("candidate_id, body, created_at")
    .in("candidate_id", candidateIds)
    .order("created_at", { ascending: false });

  // Fetch unread counts (inbound messages without read_at)
  const { data: unreadRows } = await supabase
    .from("candidate_messages")
    .select("candidate_id")
    .in("candidate_id", candidateIds)
    .eq("direction", "inbound")
    .is("read_at", null);

  const lastMessageMap: Record<string, { body: string; created_at: string }> = {};
  for (const msg of lastMessages ?? []) {
    if (!lastMessageMap[msg.candidate_id]) {
      lastMessageMap[msg.candidate_id] = { body: msg.body, created_at: msg.created_at };
    }
  }

  const unreadMap: Record<string, number> = {};
  for (const row of unreadRows ?? []) {
    unreadMap[row.candidate_id] = (unreadMap[row.candidate_id] || 0) + 1;
  }

  const threads = (candidates ?? []).map((c) => ({
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
