// src/lib/chatClient.ts
// Shared client-side helpers for talking to /api/chat — used by both the full /chat
// page and the floating ChatWidget so they can't drift apart.

export interface ChatAttachment {
  url: string;
  name: string;
  type: string;
  textContent?: string | null;
}

export async function uploadAttachment(file: File): Promise<ChatAttachment> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/chat/attachments", { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not upload attachment.");
  }
  return res.json();
}

export interface SendChatMessageResult {
  conversation_id: string;
  reply?: string;
  error?: string;
}

export async function sendChatMessage(opts: {
  message: string;
  conversationId: string | null;
  attachment?: ChatAttachment | null;
}): Promise<SendChatMessageResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.message,
      conversation_id: opts.conversationId,
      attachment: opts.attachment ?? undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { conversation_id: data.conversation_id, error: data.error || "The assistant couldn't respond." };
  }
  return data;
}
