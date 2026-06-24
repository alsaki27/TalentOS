// src/app/ChatWidget.tsx
// Floating chat bubble (bottom-right, collapsed circle -> expandable popup), present
// on every authenticated page — Messenger/Intercom-style. Shares its backend with the
// full /chat page (same /api/chat, same conversation), so "expand to full page" picks
// up exactly where the popup left off rather than starting over.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChatAttachment, sendChatMessage, uploadAttachment } from "@/lib/chatClient";

const STORAGE_KEY = "skarion_widget_conversation_id";

interface WidgetMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachmentName?: string | null;
}

export default function ChatWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pathname?.startsWith("/portal") || pathname === "/login") { setAuthed(false); return; }
    fetch("/api/auth/me")
      .then((res) => setAuthed(res.ok))
      .catch(() => setAuthed(false));
  }, [pathname]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) setConversationId(saved);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  if (!authed || pathname?.startsWith("/portal") || pathname === "/login" || pathname === "/chat") return null;

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
      attachmentName: attachment?.name,
    }]);

    const result = await sendChatMessage({ message: text, conversationId, attachment });
    setSending(false);

    if (!conversationId && result.conversation_id) {
      setConversationId(result.conversation_id);
      localStorage.setItem(STORAGE_KEY, result.conversation_id);
    }

    if (result.error) {
      setError(result.error);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: "assistant", content: `(error) ${result.error}` }]);
      return;
    }

    setMessages((prev) => [...prev, { id: `reply-${Date.now()}`, role: "assistant", content: result.reply ?? "" }]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function expandToFullPage() {
    router.push("/chat");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        style={{
          position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%",
          background: "var(--accent)", color: "white", border: "none", fontSize: 22,
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)", cursor: "pointer", zIndex: 100,
        }}
      >
        💬
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 24, right: 24, width: 340, height: 460,
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column",
        zIndex: 100, overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <strong style={{ fontSize: 13 }}>Assistant</strong>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={expandToFullPage} title="Open full page" style={{ border: "none", background: "none", padding: 0, fontSize: 14, cursor: "pointer" }}>⤢</button>
          <button onClick={() => setOpen(false)} title="Close" style={{ border: "none", background: "none", padding: 0, fontSize: 16, cursor: "pointer" }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Ask about candidates, jobs, applications, or analytics. Click ⤢ for the full chat page.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div style={{
              background: m.role === "user" ? "var(--accent)" : "var(--bg)",
              color: m.role === "user" ? "white" : "var(--ink)",
              borderRadius: "var(--radius)", padding: "8px 10px", whiteSpace: "pre-wrap", fontSize: 13,
            }}>
              {m.content}
              {m.attachmentName && <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>📎 {m.attachmentName}</div>}
            </div>
          </div>
        ))}
        {sending && <p className="muted" style={{ fontSize: 12 }}>Thinking...</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 11, padding: "0 10px" }}>{error}</p>}
      {pendingAttachment && (
        <div className="muted" style={{ fontSize: 11, padding: "0 10px", display: "flex", justifyContent: "space-between" }}>
          <span>📎 {pendingAttachment.name}</span>
          <button style={{ border: "none", background: "none", padding: "0 4px" }} onClick={() => setPendingAttachment(null)}>×</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid var(--border)" }}>
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFilePick} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach a file" style={{ padding: "6px 8px" }}>
          {uploading ? "..." : "📎"}
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask something..."
          style={{ flex: 1, resize: "none", fontSize: 13 }}
        />
        <button className="btn-primary" onClick={send} disabled={sending || (!input.trim() && !pendingAttachment)} style={{ padding: "6px 10px" }}>→</button>
      </div>
    </div>
  );
}
