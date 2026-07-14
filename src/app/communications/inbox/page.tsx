"use client";

import { useEffect, useState, useRef } from "react";
import MessageThread from "@/components/MessageThread";

interface CandidateThread {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  needs_reply: boolean;
}

interface CandidateMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: "email" | "sms" | "in_app";
  subject: string | null;
  body: string;
  sender_name: string | null;
  sender_id: string | null;
  read_at: string | null;
  created_at: string;
}

export default function InboxPage() {
  const [threads, setThreads] = useState<CandidateThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CandidateMessage[]>([]);
  const [candidate, setCandidate] = useState<CandidateThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [needsReplyFilter, setNeedsReplyFilter] = useState(false);
  const [compose, setCompose] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [channel, setChannel] = useState<"email" | "in_app">("in_app");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [sending, setSending] = useState(false);
  const [showPendingDrafts, setShowPendingDrafts] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, any>[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadThreads() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (needsReplyFilter) params.set("needsReply", "true");
    const res = await fetch(`/api/inbox/threads?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    setThreads(data.threads ?? []);
    setLoading(false);
  }

  async function loadMessages(candidateId: string) {
    const [msgRes, tplRes] = await Promise.all([
      fetch(`/api/candidate-messages?candidateId=${candidateId}`, { cache: "no-store" }),
      fetch("/api/email-templates?page=1&pageSize=50", { cache: "no-store" }),
    ]);
    const msgData = await msgRes.json();
    const tplData = await tplRes.json();
    setMessages(msgData.messages ?? []);
    setTemplates((tplData.items ?? []).map((t: any) => ({ id: t.id, name: t.name })));
  }

  async function loadTemplateBody(templateId: string) {
    if (!templateId) return;
    const res = await fetch(`/api/email-templates?page=1&pageSize=1&search=${templateId}`, { cache: "no-store" });
    const data = await res.json();
    const t = data.items?.[0];
    if (t) {
      setComposeSubject(t.subject);
      setCompose(t.body);
    }
  }

  useEffect(() => { loadThreads(); }, [search, needsReplyFilter]);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
      const c = threads.find((t) => t.id === selectedId) || null;
      setCandidate(c);
    }
  }, [selectedId]);

  useEffect(() => {
    refreshRef.current = setInterval(() => {
      if (selectedId) loadMessages(selectedId);
    }, 30000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [selectedId]);

  async function sendMessage() {
    if (!selectedId || !compose.trim()) return;
    setSending(true);
    const res = await fetch("/api/candidate-messages", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: selectedId,
        body: compose,
        subject: composeSubject || null,
        channel,
      }),
    });
    setSending(false);
    if (res.ok) {
      setCompose("");
      setComposeSubject("");
      setSelectedTemplate("");
      loadMessages(selectedId);
    } else {
      const data = await res.json();
      alert(data.error || "Failed to send message.");
    }
  }

  async function loadPendingDrafts() {
    setDraftsLoading(true);
    setShowPendingDrafts(true);
    const res = await fetch("/api/candidate-messages/pending-drafts", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setPendingDrafts(data.drafts ?? []);
    }
    setDraftsLoading(false);
  }

  async function approveDraft(draftId: string) {
    const res = await fetch(`/api/candidate-messages/${draftId}/approve`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      loadPendingDrafts();
      if (selectedId) loadMessages(selectedId);
    } else if (res.status === 409 && data.needsReconnect) {
      alert("Candidate must re-connect Gmail to grant send permission: " + (data.email || "unknown"));
    } else {
      alert(data.error || "Failed to approve draft.");
    }
  }

  async function rejectDraft(draftId: string) {
    if (!confirm("Reject this draft? It will not be sent.")) return;
    const res = await fetch(`/api/candidate-messages/${draftId}/reject`, { method: "POST" });
    if (res.ok) {
      loadPendingDrafts();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to reject draft.");
    }
  }

  const filteredThreads = threads.filter(
    (t) => t.name.toLowerCase().includes(search.toLowerCase()) || (t.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0, height: "calc(100vh - 120px)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>Inbox</h2>
          <input
            placeholder="Search candidates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 13, marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={loadPendingDrafts}
              style={{ fontSize: 12 }}
            >
              Pending drafts
            </button>
            <button
              onClick={() => setNeedsReplyFilter((v) => !v)}
              style={{ fontSize: 12, fontWeight: needsReplyFilter ? 600 : 400 }}
            >
              Needs reply
            </button>
            {showPendingDrafts && (
              <button
                onClick={() => { setShowPendingDrafts(false); setSelectedId(null); }}
                style={{ fontSize: 12 }}
              >
                Back to inbox
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {loading ? (
            <div className="empty">Loading…</div>
          ) : filteredThreads.length === 0 ? (
            <div className="empty">No candidates found.</div>
          ) : (
            filteredThreads.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background: selectedId === t.id ? "var(--bg)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  {t.needs_reply && <span className="badge badge-interview" style={{ fontSize: 10 }}>reply</span>}
                  {t.unread_count > 0 && <span className="nav-badge">{t.unread_count}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t.last_message || "No messages yet"}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main pane */}
      <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        {showPendingDrafts ? (
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
            <h2 style={{ marginBottom: 16, fontSize: 16 }}>Pending Drafts</h2>
            {draftsLoading ? (
              <div className="empty">Loading drafts…</div>
            ) : pendingDrafts.length === 0 ? (
              <div className="empty">No pending drafts.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {pendingDrafts.map((d: any) => (
                  <div key={d.id} className="card" style={{ padding: 16 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                      {d.candidate_name || "Unknown"} — Draft
                    </div>
                    {d.subject && (
                      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
                        {d.subject}
                      </div>
                    )}
                    <div style={{ marginBottom: 12, fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 100, overflow: "hidden" }}>
                      {d.body}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn-primary" onClick={() => approveDraft(d.id)}>
                        Approve &amp; Send
                      </button>
                      <button onClick={() => rejectDraft(d.id)}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : !selectedId || !candidate ? (
          <div className="empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            Select a candidate to view the conversation.
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{candidate.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{candidate.email || "—"}</div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
              <MessageThread
                messages={messages}
                candidate={{ id: candidate.id, name: candidate.name, avatar_url: candidate.avatar_url }}
              />
            </div>

            <div style={{ padding: 12, borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
                <select
                  value={selectedTemplate}
                  onChange={(e) => { setSelectedTemplate(e.target.value); loadTemplateBody(e.target.value); }}
                  style={{ width: "auto", minWidth: 160 }}
                >
                  <option value="">— Pick template —</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
                <div className="action-group" style={{ gap: 2 }}>
                  <button className={channel === "email" ? "btn-primary" : "btn-compact"} onClick={() => setChannel("email")}>Email</button>
                  <button className={channel === "in_app" ? "btn-primary" : "btn-compact"} onClick={() => setChannel("in_app")}>In-app</button>
                </div>
              </div>
              {channel === "email" && (
                <input
                  placeholder="Subject (optional)"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <textarea
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  placeholder="Type a message…"
                  style={{ flex: 1, minHeight: 60, fontSize: 13 }}
                />
                <button className="btn-primary" onClick={sendMessage} disabled={sending || !compose.trim()}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
