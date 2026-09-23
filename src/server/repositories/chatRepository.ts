// src/server/repositories/chatRepository.ts
// Data-access abstraction for chat_conversations and chat_messages tables.
// Neon-only — no Supabase fallback.

import { query, queryOne, execute } from "@/server/db/neon";

export interface ChatConversationRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_text: string | null;
  created_at: string;
}

export async function listUserConversationIds(userId: string): Promise<Pick<ChatConversationRow, "id">[]> {
  return query("SELECT id FROM chat_conversations WHERE user_id = $1", [userId]);
}

export async function countUserMessagesToday(conversationIds: string[], sinceISO: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM chat_messages WHERE role = $1 AND created_at >= $2 AND conversation_id::text = ANY($3)",
    ["user", sinceISO, conversationIds]
  );
  return parseInt(row?.count ?? "0", 10);
}

export async function createConversation(userId: string, title: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    "INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING id",
    [userId, title]
  );
  if (!row) throw new Error("Failed to create conversation");
  return row.id;
}

export async function getPriorMessages(conversationId: string, maxTurns: number): Promise<ChatMessageRow[]> {
  return query<ChatMessageRow>(
    "SELECT role, content, attachment_name, attachment_type, attachment_text FROM chat_messages WHERE conversation_id = $1 AND role = ANY($2) ORDER BY created_at ASC LIMIT $3",
    [conversationId, ["user", "assistant"], maxTurns]
  );
}

export async function insertUserMessage(
  conversationId: string,
  content: string,
  attachmentUrl: string | null,
  attachmentName: string | null,
  attachmentType: string | null,
  attachmentText: string | null
): Promise<void> {
  await execute(
    "INSERT INTO chat_messages (conversation_id, role, content, attachment_url, attachment_name, attachment_type, attachment_text) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [conversationId, "user", content, attachmentUrl, attachmentName, attachmentType, attachmentText]
  );
}

export async function insertAssistantMessage(conversationId: string, content: string): Promise<void> {
  await execute(
    "INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,$2,$3)",
    [conversationId, "assistant", content]
  );
}

export async function insertToolMessage(conversationId: string, toolName: string, content: string): Promise<void> {
  await execute(
    "INSERT INTO chat_messages (conversation_id, role, tool_name, content) VALUES ($1,$2,$3,$4)",
    [conversationId, "tool", toolName, content]
  );
}

export async function touchConversation(id: string, now: string): Promise<void> {
  await execute("UPDATE chat_conversations SET updated_at = $1 WHERE id = $2", [now, id]);
}

export async function findConversation(id: string): Promise<ChatConversationRow | null> {
  return queryOne<ChatConversationRow>("SELECT id, title, user_id FROM chat_conversations WHERE id = $1", [id]);
}

export async function getConversationMessages(conversationId: string): Promise<ChatMessageRow[]> {
  return query<ChatMessageRow>(
    "SELECT id, role, content, attachment_url, attachment_name, attachment_type, created_at FROM chat_messages WHERE conversation_id = $1 AND role = ANY($2) ORDER BY created_at ASC",
    [conversationId, ["user", "assistant"]]
  );
}

export async function getConversationOwner(conversationId: string): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>("SELECT user_id FROM chat_conversations WHERE id = $1", [conversationId]);
  return row?.user_id ?? null;
}

export async function deleteConversation(id: string): Promise<void> {
  await execute("DELETE FROM chat_conversations WHERE id = $1", [id]);
}

export async function listUserConversations(userId: string): Promise<Pick<ChatConversationRow, "id" | "title" | "updated_at">[]> {
  return query("SELECT id, title, updated_at FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50", [userId]);
}
