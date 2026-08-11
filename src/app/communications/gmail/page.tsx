"use client";

import { useCallback, useEffect, useState } from "react";

type Direction = "inbox" | "sent" | "all";

interface MailThread {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  gmail_thread_id: string;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_emails: string[] | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  ai_relevant: boolean | null;
  ai_category: string | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  ai_matched_application_id: string | null;
  needs_reply: boolean;
  replied_at: string | null;
  gmail_is_unread: boolean;
  gmail_is_important: boolean;
  job_title: string | null;
  company_name: string | null;
  message_count: number;
}

interface MailMessage extends MailThread {
  body_text: string | null;
  ingested_at: string;
  triaged_at: string | null;
  interview_details: Record<string, unknown> | null;
}

interface MailDetail {
  message: MailMessage;
  thread: MailMessage[];
  actionItems: Array<{ id: string; type: string; title: string; description: string | null; priority: string; status: string; due_at: string | null }>;
  gmailUrl: string;
}

const CATEGORIES = ["interview_invite", "scheduling", "offer", "recruiter_reply", "application_invite", "application_confirmation", "rejection", "other"];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function categoryLabel(category: string | null) {
  return (category || "untriaged").replaceAll("_", " ");
}

export default function GmailInboxPage() {
  const [direction, setDirection] = useState<Direction>("inbox");
  const [search, setSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [category, setCategory] = useState("");
  const [needsReply, setNeedsReply] = useState(false);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const loadThreads = useCallback(async (nextPage = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ direction, page: String(nextPage), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId.trim());
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    try {
      const response = await fetch(`/api/gmail-communications?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Gmail activity.");
      setThreads(data.threads || []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Number(data.totalPages || 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Gmail activity.");
    } finally {
      setLoading(false);
    }
  }, [direction, search, candidateId, category, needsReply]);

  async function openThread(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/gmail-communications/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open email thread.");
      setDetail(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open email thread.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function forceSync() {
    setSyncing(true);
    setMessage("");
    try {
      const response = await fetch("/api/candidate-dashboard/force-sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gmail sync failed.");
      const outcomes = data.result?.accounts || [];
      const errors = outcomes.filter((outcome: { error?: string }) => outcome.error);
      setMessage(errors.length
        ? `Sync completed with ${errors.length} account error(s): ${errors.map((outcome: { error?: string }) => outcome.error || "unknown error").join(" | ")}`
        : "Gmail sync completed.");
      await loadThreads(1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gmail sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadThreads(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  return (
    <div className="page" style={{ maxWidth: 1500, margin: "0 auto", padding: "28px 20px 48px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
          <h1 style={{ margin: "6px 0 4px" }}>Gmail Inbox</h1>
          <p className="muted" style={{ margin: 0 }}>Recruiting email, AI findings, application matches, and AE follow-up in one place.</p>
        </div>
        <button className="btn-primary" onClick={forceSync} disabled={syncing}>{syncing ? "Syncing…" : "↻ Sync Gmail"}</button>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["inbox", "sent", "all"] as Direction[]).map((tab) => (
          <button key={tab} className={direction === tab ? "btn-primary" : "btn"} onClick={() => setDirection(tab)}>{tab === "inbox" ? "Inbox" : tab === "sent" ? "Sent" : "All mail"}</button>
        ))}
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidate, sender, subject, body…" style={{ flex: 1, minWidth: 240 }} />
        <input value={candidateId} onChange={(event) => setCandidateId(event.target.value)} placeholder="Candidate ID (optional)" style={{ width: 190 }} />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
        </select>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }}><input type="checkbox" checked={needsReply} onChange={(event) => setNeedsReply(event.target.checked)} /> Needs reply</label>
      </div>

      {message && <div className="notice" style={{ marginBottom: 14 }}>{message}</div>}

      <div style={{ display: "grid", gridTemplateColumns: detail || detailLoading ? "minmax(0, 1fr) minmax(360px, 0.8fr)" : "1fr", gap: 14, alignItems: "start" }}>
        <section className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{total.toLocaleString()} conversation{total === 1 ? "" : "s"}</strong>
            <span className="muted" style={{ fontSize: 12 }}>Recruiting mail retained under each candidate&apos;s privacy setting; personal and promotional mail is suppressed.</span>
          </div>
          {loading ? <div style={{ padding: 40, textAlign: "center" }} className="muted">Loading mailbox…</div> : threads.length === 0 ? <div style={{ padding: 48, textAlign: "center" }} className="muted">No imported Gmail conversations match these filters.</div> : (
            <div>
              {threads.map((thread) => (
                <button key={thread.id} onClick={() => void openThread(thread.id)} style={{ width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--border)", padding: "14px 16px", background: selectedId === thread.id ? "var(--accent-soft)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {thread.gmail_is_unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: "#6366f1" }} />}
                        <strong style={{ fontWeight: thread.gmail_is_unread ? 800 : 600 }}>{thread.candidate_name}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>{thread.direction === "outbound" ? "Sent" : thread.from_email || "Unknown sender"}</span>
                        {thread.message_count > 1 && <span className="badge">{thread.message_count}</span>}
                      </div>
                      <div style={{ marginTop: 5, fontWeight: thread.gmail_is_unread ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.subject || "(no subject)"}</div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.snippet || thread.ai_summary || "No preview available."}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                        {thread.ai_category && <span className="badge">{categoryLabel(thread.ai_category)}</span>}
                        {thread.needs_reply && <span className="badge" style={{ color: "#b45309" }}>Needs reply</span>}
                        {thread.job_title && <span className="muted" style={{ fontSize: 11 }}>{thread.job_title}{thread.company_name ? ` · ${thread.company_name}` : ""}</span>}
                      </div>
                    </div>
                    <time className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{formatDate(thread.sent_at)}</time>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: 12, display: "flex", justifyContent: "center", gap: 8 }}>
            <button className="btn" disabled={page <= 1 || loading} onClick={() => void loadThreads(page - 1)}>Previous</button>
            <span className="muted" style={{ padding: "8px 4px", fontSize: 12 }}>Page {page} of {totalPages}</span>
            <button className="btn" disabled={page >= totalPages || loading} onClick={() => void loadThreads(page + 1)}>Next</button>
          </div>
        </section>

        {(detail || detailLoading) && <aside className="card" style={{ position: "sticky", top: 84, maxHeight: "calc(100vh - 110px)", overflow: "auto" }}>
          {detailLoading || !detail ? <div style={{ padding: 40, textAlign: "center" }} className="muted">Opening conversation…</div> : <>
            <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}><div><strong>{detail.message.subject || "(no subject)"}</strong><div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{detail.message.candidate_name} · {detail.message.candidate_email || "No candidate email"}</div></div><a className="btn" href={detail.gmailUrl} target="_blank" rel="noreferrer">Open Gmail</a></div>
              {detail.message.ai_summary && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--accent-soft)", fontSize: 13 }}>{detail.message.ai_summary}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}><span className="badge">{categoryLabel(detail.message.ai_category)}</span>{detail.message.ai_confidence !== null && <span className="badge">AI {Math.round(detail.message.ai_confidence * 100)}%</span>}{detail.message.needs_reply && <span className="badge" style={{ color: "#b45309" }}>Needs reply</span>}</div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              {detail.thread.map((mail) => <article key={mail.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: mail.direction === "outbound" ? "rgba(99,102,241,0.06)" : "transparent" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}><strong>{mail.direction === "outbound" ? "You / team" : mail.from_email || "Unknown sender"}</strong><time className="muted">{formatDate(mail.sent_at)}</time></div><div className="muted" style={{ marginTop: 4, fontSize: 11 }}>To: {(mail.to_emails || []).join(", ") || "—"}</div><div style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>{mail.body_text || mail.snippet || "No body text captured."}</div></article>)}
              {detail.actionItems.length > 0 && <div><strong style={{ fontSize: 13 }}>Workflow actions</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{detail.actionItems.map((item) => <div key={item.id} style={{ padding: 9, borderRadius: 8, background: "var(--surface-2, var(--bg))", fontSize: 12 }}><strong>{item.title}</strong><div className="muted">{item.status} · {item.priority}{item.due_at ? ` · due ${formatDate(item.due_at)}` : ""}</div>{item.description && <div style={{ marginTop: 4 }}>{item.description}</div>}</div>)}</div></div>}
            </div>
          </>}
        </aside>}
      </div>
    </div>
  );
}
