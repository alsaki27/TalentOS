// src/app/chat/page.tsx
// AI data assistant — chats with read-only tool access across candidates, jobs,
// applications, the activity log, analytics, import sources, and (admin-only) the
// audit log. See src/lib/ai/tools.ts for exactly what it can query. Also accepts
// file attachments (src/lib/chatClient.ts) — text files are read by the model,
// other types are stored/shown only (see /api/chat/attachments).
"use client";

import { useEffect, useRef, useState } from "react";
import { ChatAttachment, sendChatMessage, uploadAttachment } from "@/lib/chatClient";

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadConversations() {
    const res = await fetch("/api/chat/conversations");
    if (res.ok) setConversations(await res.json());
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    const res = await fetch(`/api/chat/conversations/${id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages ?? []);
    }
  }

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setError("");
    setPendingAttachment(null);
  }

  async function deleteConversation(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) startNewChat();
    loadConversations();
  }

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      setPendingAttachment(await uploadAttachment(file));
    } catch (err: any) {
      setError(err.message);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pendingAttachment) || sending) return;
    setSending(true);
    setError("");
    setInput("");
    const attachment = pendingAttachment;
    setPendingAttachment(null);

    setMessages((prev) => [...prev, {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text || `Attached: ${attachment?.name}`,
      attachment_url: attachment?.url,
      attachment_name: attachment?.name,
      attachment_type: attachment?.type,
      created_at: new Date().toISOString(),
    }]);

    const result = await sendChatMessage({ message: text, conversationId: activeId, attachment });
    setSending(false);

    if (!activeId && result.conversation_id) {
      setActiveId(result.conversation_id);
      loadConversations();
    }

    if (result.error) {
      setError(result.error);
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `(error) ${result.error}`,
        created_at: new Date().toISOString(),
      }]);
      return;
    }

    setMessages((prev) => [...prev, {
      id: `reply-${Date.now()}`,
      role: "assistant",
      content: result.reply ?? "",
      created_at: new Date().toISOString(),
    }]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Assistant</h1>
        <button onClick={startNewChat}>+ New chat</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 8 }}>
          {conversations.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, padding: 8 }}>No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", borderRadius: "var(--radius)", cursor: "pointer",
                  background: c.id === activeId ? "var(--accent-soft)" : "transparent",
                  marginBottom: 2,
                }}
                onClick={() => openConversation(c.id)}
              >
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                <button
                  style={{ border: "none", background: "none", padding: "0 4px", fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
            {messages.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Ask things like "how many OSP candidates have we interviewed this month?" or
                "what's overdue in the application queue?". Answers come from real data via tool
                calls, not guesses. You can also attach a file (text files are read in full;
                other types are shown but not analyzed yet).
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                <div
                  style={{
                    background: m.role === "user" ? "var(--accent)" : "var(--bg)",
                    color: m.role === "user" ? "white" : "var(--ink)",
                    borderRadius: "var(--radius)",
                    padding: "10px 14px",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                  }}
                >
                  {m.content}
                  {m.attachment_url && (
                    <div style={{ marginTop: 6 }}>
                      <a
                        href={m.attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: m.role === "user" ? "white" : "var(--accent)", textDecoration: "underline", fontSize: 12 }}
                      >
                        📎 {m.attachment_name}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && <p className="muted" style={{ fontSize: 13 }}>Thinking...</p>}
            <div ref={bottomRef} />
          </div>

          {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</p>}

          {pendingAttachment && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>📎 {pendingAttachment.name} ready to send</span>
              <button style={{ border: "none", background: "none", padding: "0 4px" }} onClick={() => setPendingAttachment(null)}>×</button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFilePick} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach a file">
              {uploading ? "..." : "📎"}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Ask about candidates, jobs, applications, analytics..."
              style={{ flex: 1, resize: "none" }}
            />
            <button className="btn-primary" onClick={send} disabled={sending || (!input.trim() && !pendingAttachment)}>Send</button>
          </div>
        </div>
      </div>
    </>
  );
}
