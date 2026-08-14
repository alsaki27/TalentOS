"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ApprovalCard, { type ApprovalItem } from "./components/ApprovalCard";
import EmailTaskRow, { type EmailTask } from "./components/EmailTaskRow";

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
  attachment_metadata: { filename?: string; mimeType?: string; size?: number }[];
  suppression_reason: string | null;
  suppression_rule: string | null;
  open_task_count: number;
  job_title: string | null;
  company_name: string | null;
  message_count: number;
}

interface MailMessage extends MailThread {
  body_text: string | null;
  ingested_at: string;
  triaged_at: string | null;
  interview_details: Record<string, unknown> | null;
  ai_evidence: Record<string, unknown> | null;
}

interface DetailActionItem {
  id: string; type: string; title: string; description: string | null; priority: string; status: string;
  due_at: string | null; proposed_status: string | null; proposed_from_status: string | null;
  ai_confidence: number | null; decision: string | null;
}

interface MailDetail {
  message: MailMessage;
  thread: MailMessage[];
  actionItems: DetailActionItem[];
  gmailUrl: string;
}

interface InboxCounts {
  approvals: { pending: number; urgent: number; approvedToday: number; rejectedToday: number };
  tasks: { needsReply: number; interviews: number; untracked: number; conflicts: number; escalated: number };
  mail: { relevant: number; awaitingReply: number; hidden: number; total: number; lastMessageAt: string | null };
}

const CATEGORIES = ["interview_invite", "scheduling", "offer", "recruiter_reply", "application_invite", "application_confirmation", "rejection", "other"];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function categoryLabel(category: string | null) {
  return (category || "untriaged").replaceAll("_", " ");
}

export default function InboxPage() {
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [direction, setDirection] = useState<Direction>("inbox");
  const [search, setSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState("");
  const [needsReply, setNeedsReply] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
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
  const [tasks, setTasks] = useState<EmailTask[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [gmailCandidateId, setGmailCandidateId] = useState("");
  const [connectingClientGmail, setConnectingClientGmail] = useState(false);
  const busyRef = useRef(false);

  const loadCounts = useCallback(async () => {
    const params = candidateId ? `?candidateId=${candidateId}` : "";
    const res = await fetch(`/api/inbox/counts${params}`, { cache: "no-store" });
    if (res.ok) setCounts(await res.json());
  }, [candidateId]);

  const loadTasks = useCallback(async () => {
    if (busyRef.current) return;
    const [openRes, inProgressRes] = await Promise.all([
      fetch("/api/action-items?status=open", { cache: "no-store" }),
      fetch("/api/action-items?status=in_progress", { cache: "no-store" }),
    ]);
    const openData = openRes.ok ? await openRes.json() : { items: [] };
    const inProgressData = inProgressRes.ok ? await inProgressRes.json() : { items: [] };
    const merged = [...(openData.items ?? []), ...(inProgressData.items ?? [])].filter((t: any) => t.type !== "status_change_approval");
    setTasks(merged);
  }, []);

  const loadThreads = useCallback(async (nextPage = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ direction, page: String(nextPage), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (!showHidden) params.set("relevant", "true");
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
  }, [direction, search, candidateId, category, needsReply, showHidden]);

  // Periodic background refresh of the current page: merge by id instead of
  // replacing the array wholesale, so it doesn't reset scroll position or
  // fight with an open detail pane. Skipped while any dialog-driving fetch
  // is already in flight, since there's nothing useful to merge yet.
  const refreshThreadsInPlace = useCallback(async () => {
    if (loading) return;
    const params = new URLSearchParams({ direction, page: String(page), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (!showHidden) params.set("relevant", "true");
    try {
      const response = await fetch(`/api/gmail-communications?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const fresh: MailThread[] = data.threads || [];
      setThreads((prev) => {
        const byId = new Map(fresh.map((t) => [t.id, t]));
        const stillPresent = prev.filter((p) => byId.has(p.id)).map((p) => ({ ...p, ...byId.get(p.id)! }));
        const presentIds = new Set(prev.map((p) => p.id));
        const newOnes = fresh.filter((t) => !presentIds.has(t.id));
        return [...newOnes, ...stillPresent];
      });
      setTotal(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
    } catch {
      // Silent - the next tick retries.
    }
  }, [direction, search, candidateId, category, needsReply, showHidden, page, loading]);

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
      await Promise.all([loadThreads(1), loadCounts(), loadTasks()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gmail sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function updateTask(id: string, status: string, note: string | undefined, takeover: boolean) {
    busyRef.current = true;
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution_note: note, takeover }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not update task"); }
      await Promise.all([loadTasks(), loadCounts()]);
    } finally {
      busyRef.current = false;
    }
  }

  function connectClientGmail() {
    if (!gmailCandidateId || connectingClientGmail) return;
    setConnectingClientGmail(true);
    window.location.href = `/api/integrations/gmail/start?owner=candidate&candidateId=${encodeURIComponent(gmailCandidateId)}&redirect=${encodeURIComponent("/inbox")}`;
  }

  async function bulkCorrect(status: "dismissed" | "done") {
    if (!selectedTaskIds.length) return;
    const res = await fetch("/api/action-items/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selectedTaskIds, status, reason: "Bulk corrected from Gmail inbox" }) });
    if (!res.ok) { setMessage("Bulk correction failed."); return; }
    setSelectedTaskIds([]); await Promise.all([loadTasks(), loadCounts()]);
  }

  async function submitFeedback(kind: "noise" | "relevant" | "needs_reply") {
    if (!detail) return;
    const res = await fetch(`/api/gmail-communications/${detail.message.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    if (!res.ok) { setMessage("Could not save email feedback."); return; }
    setMessage(kind === "noise" ? "Email marked as noise and related work dismissed." : "Email feedback saved.");
    await Promise.all([loadCounts(), loadTasks(), openThread(detail.message.id)]);
  }

  function onProposalDecided(itemId: string) {
    setDetail((prev) => prev ? { ...prev, actionItems: prev.actionItems.map((a) => a.id === itemId ? { ...a, decision: "decided" } : a) } : prev);
    loadCounts();
    loadThreads(page);
  }

  useEffect(() => {
    fetch("/api/candidates?compact=1&pageSize=500")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCandidates(Array.isArray(data) ? data : (data.items ?? [])))
      .catch(() => {});
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadThreads(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  // Live-ish without a dedicated polling loop per surface: counts refresh
  // every 20s, matching /api/inbox/counts's own cheap two-aggregate cost.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadCounts();
    }, 20000);
    return () => clearInterval(interval);
  }, [loadCounts]);

  // Thread list refreshes every 60s - the plan's slowest tier, since this
  // list is the heaviest of the three polled surfaces.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refreshThreadsInPlace();
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshThreadsInPlace]);

  const pendingProposal = detail?.actionItems.find((a) => a.type === "status_change_approval" && !a.decision);

  const tiles: { key: string; label: string; value: number; onClick?: () => void }[] = [
    { key: "approvals", label: "Needs approval", value: counts?.approvals.pending ?? 0 },
    { key: "reply", label: "Needs reply", value: counts?.tasks.needsReply ?? 0, onClick: () => { setNeedsReply(true); setCategory(""); } },
    { key: "interviews", label: "Interviews", value: counts?.tasks.interviews ?? 0, onClick: () => { setCategory("interview_invite"); setNeedsReply(false); } },
    { key: "untracked", label: "Untracked applications", value: counts?.tasks.untracked ?? 0 },
    { key: "all", label: "All recruiting mail", value: counts?.mail.relevant ?? 0, onClick: () => { setCategory(""); setNeedsReply(false); setSearch(""); setCandidateId(""); } },
  ];

  return (
    <div className="page" style={{ maxWidth: 1500, margin: "0 auto", padding: "28px 20px 48px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
          <h1 style={{ margin: "6px 0 4px" }}>Candidate Inbox</h1>
          <p className="page-kicker" style={{ margin: 0 }}>Recruiting email, AI findings, application matches, and AE follow-up in one place.</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Link href="/inbox/command-center" className="btn-primary" style={{textDecoration:"none"}}>Command center</Link><Link href="/inbox/health" className="btn" style={{textDecoration:"none"}}>Inbox health</Link><Link href="/gmail-sender-rules" className="btn" style={{textDecoration:"none"}}>Sender rules</Link><button className="btn-primary" onClick={forceSync} disabled={syncing}>{syncing ? "Syncing…" : "↻ Sync Gmail"}</button></div>
      </div>

      <section className="card" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}><strong>Connect a client Gmail</strong><div className="text-muted-foreground" style={{ fontSize: 12, marginTop: 4 }}>Admins and managers can start OAuth for a selected candidate. The client signs into Google and grants mailbox access.</div></div>
        <select value={gmailCandidateId} onChange={(event) => setGmailCandidateId(event.target.value)} style={{ minWidth: 240 }} aria-label="Client candidate for Gmail connection">
          <option value="">Select client candidate…</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
        <button className="btn-primary" onClick={connectClientGmail} disabled={!gmailCandidateId || connectingClientGmail}>{connectingClientGmail ? "Opening Google…" : "Connect client Gmail"}</button>
      </section>

      <div className="stats-strip" style={{ marginBottom: 16 }}>
        {tiles.map((tile) => {
          const clickable = Boolean(tile.onClick);
          return (
            <button
              key={tile.key}
              className={clickable ? "stat-button" : "stat-card"}
              onClick={tile.onClick}
              disabled={!clickable}
              style={!clickable ? { cursor: "default" } : undefined}
            >
              <span className="stat-label">{tile.label}</span>
              <span className="stat-value">{tile.value}</span>
            </button>
          );
        })}
      </div>
      {(counts?.approvals.pending ?? 0) > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Link href="/inbox/approvals" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
            Review {counts?.approvals.pending} pending {counts?.approvals.pending === 1 ? "approval" : "approvals"} →
          </Link>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Needs a reply or a manual check ({tasks.length})</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {tasks.length > 0 && <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",padding:"8px 0"}}><strong>{selectedTaskIds.length} selected</strong><button className="btn" disabled={!selectedTaskIds.length} onClick={()=>void bulkCorrect("dismissed")}>Dismiss selected</button><button className="btn" disabled={!selectedTaskIds.length} onClick={()=>void bulkCorrect("done")}>Resolve selected</button></div>}
            {tasks.map((task) => <div key={task.id} style={{display:"grid",gridTemplateColumns:"22px minmax(0,1fr)",gap:8,alignItems:"start"}}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={(e)=>setSelectedTaskIds(prev=>e.target.checked?[...prev,task.id]:prev.filter(id=>id!==task.id))} aria-label={`Select ${task.title}`} /><EmailTaskRow task={task} onUpdate={updateTask} /></div>)}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["inbox", "sent", "all"] as Direction[]).map((tab) => (
          <button key={tab} className={direction === tab ? "btn-primary" : "btn"} onClick={() => setDirection(tab)}>{tab === "inbox" ? "Inbox" : tab === "sent" ? "Sent" : "All mail"}</button>
        ))}
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidate, sender, subject, body…" style={{ flex: 1, minWidth: 240 }} />
        <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} style={{ width: 200 }}>
          <option value="">All candidates</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
        </select>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }}>
          <input type="checkbox" checked={needsReply} onChange={(event) => setNeedsReply(event.target.checked)} /> Needs reply
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }} title="Include mail filtered out by the AI (job-board alerts, personal mail) so you can double-check a call">
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> Show hidden mail
        </label>
      </div>

      {message && <div className="notice">{message}<button className="alert-close" onClick={() => setMessage("")}>×</button></div>}

      <div style={{ display: "grid", gridTemplateColumns: detail || detailLoading ? "minmax(0, 1fr) minmax(360px, 0.8fr)" : "1fr", gap: 14, alignItems: "start", marginTop: message ? 14 : 0 }}>
        <section className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{total.toLocaleString()} conversation{total === 1 ? "" : "s"}</strong>
            <span className="text-muted-foreground" style={{ fontSize: 12 }}>{showHidden ? "Showing hidden mail too." : "Hidden by filters is not shown — toggle above to see it."}</span>
          </div>
          {loading ? <div style={{ padding: 40, textAlign: "center" }} className="text-muted-foreground">Loading mailbox…</div> : threads.length === 0 ? <div style={{ padding: 48, textAlign: "center" }} className="text-muted-foreground">No conversations match these filters.</div> : (
            <div>
              {threads.map((thread) => (
                <button key={thread.id} onClick={() => void openThread(thread.id)} style={{ width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--border)", padding: "14px 16px", background: selectedId === thread.id ? "var(--accent-soft)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {thread.gmail_is_unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: "#6366f1" }} />}
                        <strong style={{ fontWeight: thread.gmail_is_unread ? 800 : 600 }}>{thread.candidate_name}</strong>
                        <span className="text-muted-foreground" style={{ fontSize: 12 }}>{thread.direction === "outbound" ? "Sent" : thread.from_email || "Unknown sender"}</span>
                        {thread.message_count > 1 && <span className="badge">{thread.message_count}</span>}
                      </div>
                      <div style={{ marginTop: 5, fontWeight: thread.gmail_is_unread ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.subject || "(no subject)"}</div>
                      <div className="text-muted-foreground" style={{ marginTop: 4, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.snippet || thread.ai_summary || "No preview available."}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                        {thread.ai_category && <span className="badge">{categoryLabel(thread.ai_category)}</span>}
                        {thread.needs_reply && <span className="badge" style={{ color: "#b45309" }}>Needs reply</span>}
                        {thread.open_task_count > 0 && <span className="badge badge-priority-high">{thread.open_task_count} open</span>}
                        {thread.suppression_reason && <span className="badge" title={thread.suppression_rule ?? undefined}>Hidden by filters</span>}
                        {thread.job_title && <span className="text-muted-foreground" style={{ fontSize: 11 }}>{thread.job_title}{thread.company_name ? ` · ${thread.company_name}` : ""}</span>}
                      </div>
                    </div>
                    <time className="text-muted-foreground" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{formatDate(thread.sent_at)}</time>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: 12, display: "flex", justifyContent: "center", gap: 8 }}>
            <button className="btn" disabled={page <= 1 || loading} onClick={() => void loadThreads(page - 1)}>Previous</button>
            <span className="text-muted-foreground" style={{ padding: "8px 4px", fontSize: 12 }}>Page {page} of {totalPages}</span>
            <button className="btn" disabled={page >= totalPages || loading} onClick={() => void loadThreads(page + 1)}>Next</button>
          </div>
        </section>

        {(detail || detailLoading) && <aside className="card" style={{ position: "sticky", top: 84, maxHeight: "calc(100vh - 110px)", overflow: "auto" }}>
          {detailLoading || !detail ? <div style={{ padding: 40, textAlign: "center" }} className="text-muted-foreground">Opening conversation…</div> : <>
            <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <strong>{detail.message.subject || "(no subject)"}</strong>
                  <div className="text-muted-foreground" style={{ marginTop: 4, fontSize: 12 }}>{detail.message.candidate_name} · {detail.message.candidate_email || "No candidate email"}</div>
                </div>
                <a className="btn" href={detail.gmailUrl} target="_blank" rel="noreferrer">Open Gmail</a>
              </div>
              {detail.message.ai_summary && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--accent-soft)", fontSize: 13 }}>{detail.message.ai_summary}</div>}
              {detail.message.ai_evidence && Object.keys(detail.message.ai_evidence).length > 0 && <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: "pointer" }}>Why AI classified this</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--ink-soft)", marginTop: 8 }}>{JSON.stringify(detail.message.ai_evidence, null, 2)}</pre></details>}
              {!!detail.message.attachment_metadata?.length && <div className="muted" style={{ marginTop: 10 }}>Attachments: {detail.message.attachment_metadata.map((a) => a.filename || "unnamed file").join(", ")}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <span className="badge">{categoryLabel(detail.message.ai_category)}</span>
                {detail.message.ai_confidence !== null && <span className="badge">AI {Math.round(detail.message.ai_confidence * 100)}%</span>}
                {detail.message.needs_reply && <span className="badge" style={{ color: "#b45309" }}>Needs reply</span>}
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              {pendingProposal && (
                <ApprovalCard
                  compact
                  item={{
                    id: pendingProposal.id,
                    candidate_id: detail.message.candidate_id,
                    candidate_name: detail.message.candidate_name,
                    application_id: detail.message.ai_matched_application_id,
                    title: pendingProposal.title,
                    description: pendingProposal.description,
                    priority: pendingProposal.priority as ApprovalItem["priority"],
                    status: pendingProposal.status,
                    created_at: "",
                    due_at: pendingProposal.due_at,
                    proposed_status: pendingProposal.proposed_status,
                    proposed_from_status: pendingProposal.proposed_from_status,
                    ai_confidence: pendingProposal.ai_confidence,
                    decision: pendingProposal.decision,
                    gmail_thread_id: detail.message.gmail_thread_id,
                  }}
                  onDecided={() => onProposalDecided(pendingProposal.id)}
                />
              )}
              {detail.thread.map((mail) => (
                <article key={mail.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: mail.direction === "outbound" ? "rgba(99,102,241,0.06)" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                    <strong>{mail.direction === "outbound" ? "You / team" : mail.from_email || "Unknown sender"}</strong>
                    <time className="text-muted-foreground">{formatDate(mail.sent_at)}</time>
                  </div>
                  <div className="text-muted-foreground" style={{ marginTop: 4, fontSize: 11 }}>To: {(mail.to_emails || []).join(", ") || "—"}</div>
                  <div style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>{mail.body_text || mail.snippet || "No body text captured."}</div>
                </article>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
                <button className="btn" onClick={() => void submitFeedback("noise")}>Mark noise</button>
                <button className="btn" onClick={() => void submitFeedback("relevant")}>Mark relevant</button>
                <button className="btn" onClick={() => void submitFeedback("needs_reply")}>Needs reply</button>
              </div>
              {detail.actionItems.filter((a) => a.type !== "status_change_approval").length > 0 && (
                <div>
                  <strong style={{ fontSize: 13 }}>Workflow actions</strong>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {detail.actionItems.filter((a) => a.type !== "status_change_approval").map((item) => (
                      <div key={item.id} style={{ padding: 9, borderRadius: 8, background: "var(--surface-2)", fontSize: 12 }}>
                        <strong>{item.title}</strong>
                        <div className="text-muted-foreground">{item.status} · {item.priority}{item.due_at ? ` · due ${formatDate(item.due_at)}` : ""}</div>
                        {item.description && <div style={{ marginTop: 4 }}>{item.description}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>}
        </aside>}
      </div>
    </div>
  );
}
