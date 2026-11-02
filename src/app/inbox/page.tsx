"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GmailConnectionHeader } from "./components/GmailConnectionHeader";
import { UnassignedPanel } from "./components/UnassignedPanel";
import { PriorityBadge } from "./components/PriorityBadge";
import EmailActionModal from "./components/EmailActionModal";

type Direction = "inbox" | "sent" | "all";
type PageTab = "inbox" | "unassigned" | "handovers";

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
  manual_replied_at?: string | null;
  detected_replied_at?: string | null;
  effective_replied_at?: string | null;
  forwarded_candidate_reply?: boolean;
  response_due_at?: string | null;
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

interface InboxCounts {
  approvals: { pending: number; urgent: number; approvedToday: number; rejectedToday: number };
  tasks: { needsReply: number; interviews: number; untracked: number; conflicts: number; escalated: number };
  mail: { relevant: number; awaitingReply: number; hidden: number; total: number; lastMessageAt: string | null };
  unassigned: { total: number };
  handovers: { assignedToMe: number; overdue: number };
  categories: { category: string; count: number }[];
}

const CATEGORIES = ["interview_invite", "scheduling", "offer", "recruiter_reply", "application_invite", "application_confirmation", "rejection", "other"];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function categoryLabel(category: string | null) {
  return (category || "untriaged").replaceAll("_", " ");
}

function threadCardAppearance(thread: MailThread) {
  const ageMs = Date.now() - new Date(thread.sent_at).getTime();
  const awaitingReply = thread.needs_reply && !thread.effective_replied_at && !thread.detected_replied_at;
  if (awaitingReply && ageMs >= 24 * 3_600_000 && ageMs <= 168 * 3_600_000) {
    return { background: "#30181b", border: "1px solid #dc2626" };
  }
  if (thread.effective_replied_at || thread.detected_replied_at) return { background: "#12231a", border: "1px solid #166534" };
  if (awaitingReply) return { background: "#1a1930", border: "1px solid #7c3aed" };
  return { background: "var(--bg)", border: "1px solid var(--border)" };
}

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<PageTab>("inbox");
  const [counts, setCounts] = useState<InboxCounts | null>(null);

  // Inbox state
  const [direction, setDirection] = useState<Direction>("inbox");
  const [search, setSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [candidatesError, setCandidatesError] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesRetryKey, setCandidatesRetryKey] = useState(0);
  const [category, setCategory] = useState("");
  const [needsReply, setNeedsReply] = useState(true);
  const [replyStatus, setReplyStatus] = useState("all");
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<{ category: string | null; count: number }[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);

  // Global state
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  // Handovers state
  const [handovers, setHandovers] = useState<any[]>([]);
  const [loadingHandovers, setLoadingHandovers] = useState(false);

  const loadCounts = useCallback(async () => {
    const params = candidateId ? `?candidateId=${candidateId}` : "";
    const res = await fetch(`/api/inbox/counts${params}`, { cache: "no-store" });
    if (res.ok) setCounts(await res.json());
  }, [candidateId]);

  const loadThreads = useCallback(async (nextPage = 1) => {
    if (activeTab !== "inbox") return;
    setLoading(true);
    const params = new URLSearchParams({ direction, page: String(nextPage), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (replyStatus !== "all") params.set("replyStatus", replyStatus);
    try {
      const response = await fetch(`/api/gmail-communications?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Gmail activity.");
      setThreads(data.threads || []);
      setTotal(Number(data.total || 0));
      setCategoryCounts(Array.isArray(data.categoryCounts) ? data.categoryCounts : []);
      setPage(Number(data.page || nextPage));
      setTotalPages(Number(data.totalPages || 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Gmail activity.");
    } finally {
      setLoading(false);
    }
  }, [direction, search, candidateId, category, needsReply, replyStatus, activeTab]);

  const loadHandoversData = useCallback(async () => {
    if (activeTab !== "handovers") return;
    setLoadingHandovers(true);
    try {
      const params = new URLSearchParams();
      if (candidateId) params.set("candidateId", candidateId);
      const query = params.toString();
      const res = await fetch(`/api/inbox/handover${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setHandovers(data.handovers || []);
    } catch (e) {} finally {
      setLoadingHandovers(false);
    }
  }, [activeTab, candidateId]);

  const refreshThreadsInPlace = useCallback(async () => {
    if (loading || activeTab !== "inbox") return;
    const params = new URLSearchParams({ direction, page: String(page), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (replyStatus !== "all") params.set("replyStatus", replyStatus);
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
      if (Array.isArray(data.categoryCounts)) setCategoryCounts(data.categoryCounts);
      setTotalPages(Number(data.totalPages || 1));
    } catch {}
  }, [direction, search, candidateId, category, needsReply, replyStatus, page, loading, activeTab]);

  useEffect(() => {
    let cancelled = false;

    const loadCandidates = async (attempt: number) => {
      if (!cancelled) {
        setCandidatesLoading(true);
        setCandidatesError(false);
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const r = await fetch("/api/candidates?compact=1&pageSize=200", { signal: controller.signal });
        clearTimeout(timeout);
        const data = r.ok ? await r.json() : [];
        if (cancelled) return;
        setCandidates(Array.isArray(data) ? data : (data.items ?? []));
        setCandidatesLoading(false);
      } catch {
        if (cancelled) return;
        if (attempt < 2) {
          setTimeout(() => loadCandidates(attempt + 1), 1500);
        } else {
          setCandidatesLoading(false);
          setCandidatesError(true);
        }
      }
    };
    void loadCandidates(0);

    return () => {
      cancelled = true;
    };
  }, [candidatesRetryKey]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadThreads(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => { loadHandoversData(); }, [loadHandoversData]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const emailId = url.searchParams.get("emailId");
    const linkedCandidateId = url.searchParams.get("candidateId");
    if (linkedCandidateId) setCandidateId(linkedCandidateId);
    if (!emailId) return;
    let cancelled = false;
    void fetch(`/api/gmail-communications/${encodeURIComponent(emailId)}`, { cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open the linked email.");
      if (cancelled || !data.message) return;
      const message = data.message;
      setActiveTab("inbox");
      setSelectedThread({
        ...message,
        candidate_name: message.candidate_name || "Unassigned",
        gmail_is_unread: Boolean(message.gmail_is_unread),
        gmail_is_important: Boolean(message.gmail_is_important),
        attachment_metadata: message.attachment_metadata || [],
        suppression_reason: null,
        suppression_rule: null,
        open_task_count: (data.actionItems || []).filter((item: any) => ["open", "in_progress"].includes(item.status)).length,
        message_count: Array.isArray(data.thread) ? data.thread.length : 1,
      });
      const cleanQuery = linkedCandidateId ? `?candidateId=${encodeURIComponent(linkedCandidateId)}` : "";
      window.history.replaceState({}, "", `${url.pathname}${cleanQuery}`);
    }).catch((cause) => {
      if (!cancelled) { setMessage(cause instanceof Error ? cause.message : "Could not open the linked email."); setMessageKind("error"); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadCounts();
    }, 20000);
    return () => clearInterval(interval);
  }, [loadCounts]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refreshThreadsInPlace();
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshThreadsInPlace]);

  async function forceSync() {
    setSyncing(true);
    setMessage("");
    try {
      const response = await fetch("/api/candidate-dashboard/force-sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gmail sync failed.");
      const outcomes = Array.isArray(data?.result?.accounts) ? data.result.accounts : [];
      if (outcomes.length === 0) {
        setMessageKind("error");
        setMessage("No active shared Gmail account was available for syncing.");
        await Promise.all([loadThreads(1), loadCounts()]);
        return;
      }
      setMessageKind("success");
      const busy = outcomes.some((outcome: any) => outcome?.busy);
      if (busy) {
        setMessage("Gmail sync is already in progress. New mail will appear when that run finishes.");
      } else {
        const filtered = outcomes.reduce((sum: number, outcome: any) => sum + Number(outcome?.suppressed || 0), 0);
        const unmatched = outcomes.reduce((sum: number, outcome: any) => sum + Number(outcome?.unmatched || 0), 0);
        const details = [
          filtered ? `${filtered} filtered` : "",
          unmatched ? `${unmatched} unmatched and not stored` : "",
        ].filter(Boolean).join(" · ");
        setMessage(details ? `Gmail sync completed — ${details}.` : "Gmail sync completed.");
      }
      await Promise.all([loadThreads(1), loadCounts()]);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Gmail sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function markThreadReplied(thread: MailThread) {
    try {
      const response = await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "mark_replied" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not mark this conversation replied.");
      const leavesDefault = direction === "inbox" && needsReply;
      if (leavesDefault) {
        setThreads((previous) => previous.filter((item) => item.id !== thread.id));
        setTotal((previous) => Math.max(0, previous - 1));
      } else {
        setThreads((previous) => previous.map((item) => item.id === thread.id ? { ...item, needs_reply: false, manual_replied_at: new Date().toISOString(), effective_replied_at: new Date().toISOString() } : item));
      }
      setSelectedThread((current) => current?.id === thread.id ? { ...current, needs_reply: false, manual_replied_at: new Date().toISOString(), effective_replied_at: new Date().toISOString() } : current);
      if (leavesDefault) void loadThreads(page);
      void loadCounts();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not mark this conversation replied.");
      setMessageKind("error");
    }
  }

  async function markThreadNoReplyNeeded(thread: MailThread) {
    try {
      const response = await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "no_reply_needed" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not mark this email as no reply needed.");
      const disappearsFromDefault = direction === "inbox" && needsReply;
      if (disappearsFromDefault) {
        setThreads((previous) => previous.filter((item) => item.id !== thread.id));
        setTotal((previous) => Math.max(0, previous - 1));
        void loadThreads(page);
      } else {
        setThreads((previous) => previous.map((item) => item.id === thread.id ? { ...item, needs_reply: false } : item));
      }
      setSelectedThread((current) => current?.id === thread.id ? { ...current, needs_reply: false } : current);
      void loadCounts();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not mark this email as no reply needed.");
      setMessageKind("error");
    }
  }

  const handleUpdateHandover = async (id: string, status: string) => {
    await fetch(`/api/inbox/handover`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status })
    });
    loadHandoversData();
    loadCounts();
  };

  function goToPage(val: string) {
    const p = parseInt(val.trim(), 10);
    if (isNaN(p) || p < 1 || p > totalPages) {
      setPageError(`Enter a number between 1 and ${totalPages}`);
      return;
    }
    setPageError("");
    loadThreads(p);
  }

  function renderPagination(options: { marginTop: number; marginBottom: number }) {
    if (total <= 0) return null;
    return (
      <div className="filter-bar" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: options.marginTop, marginBottom: options.marginBottom }}>
        <button className="btn outline" onClick={() => loadThreads(page - 1)} disabled={loading || page <= 1}>Prev</button>
        {(() => {
          const pages: Array<number | string> = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else if (page <= 4) {
            pages.push(1, 2, 3, 4, 5, "...", totalPages);
          } else if (page >= totalPages - 3) {
            pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
          } else {
            pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
          }
          return pages.map((entry, index) => (
            <button
              key={`${entry}-${index}`}
              className={entry === page ? "btn-primary" : "btn outline"}
              onClick={() => typeof entry === "number" && entry !== page ? loadThreads(entry) : undefined}
              disabled={loading || entry === "..."}
              style={{
                minWidth: 36, textAlign: "center",
                cursor: entry === "..." || entry === page ? "default" : "pointer",
                padding: "6px 12px", background: entry === "..." ? "transparent" : undefined,
                border: entry === "..." ? "none" : undefined, opacity: entry === "..." ? 0.7 : undefined,
              }}
            >{entry}</button>
          ));
        })()}
        <button className="btn outline" onClick={() => loadThreads(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        <span className="muted" style={{ marginLeft: 16, fontSize: 13, color: "var(--muted)" }}>Page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => { setPageInput(e.target.value); setPageError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") goToPage(pageInput); }}
          placeholder={`1–${totalPages}`}
          className="input"
          style={{ width: 70, padding: "5px 8px", fontSize: 13 }}
        />
        <button className="btn outline" onClick={() => goToPage(pageInput)} style={{ padding: "5px 12px", fontSize: 13 }}>Go</button>
        {pageError && <span className="form-error" style={{ fontSize: 12, marginLeft: 6, color: "var(--danger)" }}>{pageError}</span>}
      </div>
    );
  }

  return (
    <div className="page inbox-page" style={{ maxWidth: "100%", margin: "0 auto", padding: "20px 20px 40px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
        <h1 style={{ margin: "6px 0 4px" }}>Candidate Inbox</h1>
        <p className="page-kicker" style={{ margin: 0 }}>One shared Gmail inbox, automatically matched to each candidate, with AI findings, application matches, and AE follow-up in one place.</p>
      </div>

      <div style={{ marginBottom: 12 }}>
        <GmailConnectionHeader />
      </div>

      <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border)", marginBottom: 14, flexWrap: "wrap" }}>
        <button
          className={`btn text ${activeTab === "inbox" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "inbox" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("inbox")}
        >
          Inbox {counts?.mail.total ? `(${counts.mail.total})` : ""}
        </button>
        <button
          className={`btn text ${activeTab === "unassigned" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "unassigned" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("unassigned")}
        >
          Unassigned {counts?.unassigned?.total ? `(${counts.unassigned.total})` : ""}
        </button>
        <button
          className={`btn text ${activeTab === "handovers" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "handovers" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("handovers")}
        >
          My Handovers {counts?.handovers?.assignedToMe ? `(${counts.handovers.assignedToMe})` : ""}
        </button>
      </div>

      {message && <div className={`alert ${messageKind}`} style={{ marginBottom: 20 }}>{message}<button className="alert-close" onClick={() => setMessage("")}>×</button></div>}

      {/* INBOX TAB */}
      {activeTab === "inbox" && (
        <>
          <div className="inbox-filter-box" style={{ padding: "8px 10px", marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--surface-2, #1a1a2e)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 2, background: "var(--bg, #111)", borderRadius: 7, padding: 3, border: "1px solid var(--border)" }}>
              {(["inbox", "sent", "all"] as Direction[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setDirection(tab);
                    if (tab === "inbox") { setNeedsReply(true); setReplyStatus("all"); }
                    else { setNeedsReply(false); setReplyStatus("all"); }
                  }}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 5,
                    border: "none",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    background: direction === tab ? "var(--accent, #6366f1)" : "transparent",
                    color: direction === tab ? "#fff" : "var(--muted)",
                  }}
                >
                  {tab === "inbox" ? "Inbox" : tab === "sent" ? "Sent / forwarded" : "All mail"}
                </button>
              ))}
            </div>
            <button
              onClick={forceSync}
              disabled={syncing}
              style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                fontSize: 13,
                fontWeight: 600,
                cursor: syncing ? "not-allowed" : "pointer",
                background: "transparent",
                color: "var(--muted)",
              }}
            >
              {syncing ? "Syncing…" : "↻ Sync Gmail"}
            </button>
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sender, subject, body, or Thread ID…" style={{ flex: 1, minWidth: 240 }} />
            <select className="input" value={replyStatus} onChange={(event) => { setReplyStatus(event.target.value); if (event.target.value !== "all") setNeedsReply(false); }} aria-label="Filter by reply status" style={{ minWidth: 190 }}>
              <option value="all">All reply states</option>
              <option value="needs-reply">Needs reply</option>
              <option value="waiting-12h">Waiting · 12+ hours</option>
              <option value="overdue-24h">Overdue · 24+ hours</option>
              <option value="replied">Team replied</option>
              <option value="no-reply-needed">No reply needed</option>
            </select>
            <select
              className="input"
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
              aria-label="Filter inbox and handovers by candidate"
              title="Filter inbox and handovers by candidate"
              style={{ minWidth: 210 }}
            >
              <option value="">All candidates</option>
              {[...candidates].sort((a, b) => a.name.localeCompare(b.name)).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
              <label className="filter-bar-check inbox-needs-reply-check">
                <input type="checkbox" checked={needsReply} onChange={(event) => { setNeedsReply(event.target.checked); if (event.target.checked) setReplyStatus("all"); }} />
                <span><strong>Needs reply</strong><small>Only unanswered candidate mail</small></span>
              </label>
              {candidatesLoading && candidates.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>Loading candidates…</span>}
              {candidatesError && <span style={{ fontSize: 12, color: "var(--danger, #dc2626)", display: "inline-flex", gap: 6, alignItems: "center", alignSelf: "center" }}>Couldn&apos;t load candidates.<button className="btn text sm" onClick={() => setCandidatesRetryKey((key) => key + 1)}>Retry</button></span>}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--muted)", margin: "-5px 2px 14px" }}>
            AI-hidden mail stays visible in matching results. Forwarded candidate replies appear under Sent / forwarded.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {(() => {
              // totalRelevant is the sum of ALL category buckets returned by the
              // API (which uses the same filters as the thread list but without
              // the per-category filter). This correctly includes null-category
              // threads that the old counts.categories sum excluded.
              const totalRelevant = categoryCounts.reduce((sum, c) => sum + c.count, 0);
              const chipStyle = (active: boolean) => ({
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: active ? "var(--accent-soft)" : "var(--surface)",
                color: active ? "var(--accent)" : "var(--ink)",
                fontWeight: active ? 700 : 500,
              });
              return (
                <>
                  <button type="button" style={chipStyle(category === "")} onClick={() => setCategory("")}>
                    All categories <span style={{ opacity: 0.7 }}>({totalRelevant})</span>
                  </button>
                  {CATEGORIES.map((value) => {
                    const count = categoryCounts.find((c) => c.category === value)?.count ?? 0;
                    return (
                      <button
                        key={value}
                        type="button"
                        style={chipStyle(category === value)}
                        onClick={() => setCategory(category === value ? "" : value)}
                      >
                        {categoryLabel(value)} <span style={{ opacity: 0.7 }}>({count})</span>
                      </button>
                    );
                  })}
                </>
              );
            })()}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "0 4px", display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
              <span>{total.toLocaleString()} conversations</span>
              <span>AI-hidden mail stays included · replied and no-reply-needed threads leave the default reply queue.</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center" }} className="text-muted">Loading mailbox…</div>
            ) : threads.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }} className="text-muted">No conversations match these filters.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {threads.map((thread) => (
                  <div key={thread.id} onClick={() => setSelectedThread(thread)} style={{ width: "100%", textAlign: "left", padding: "14px", ...threadCardAppearance(thread), borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }} className="hover:border-[var(--accent)] hover:shadow-sm">
                    <div className="inbox-thread-row" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={!thread.suppression_reason && thread.ai_relevant !== false}
                        onClick={(event) => event.stopPropagation()}
                        onChange={async (event) => {
                          const nextShown = event.target.checked;
                          setThreads((prev) => prev.map((t) => t.id === thread.id
                            ? { ...t, suppression_reason: nextShown ? null : "manager_feedback", ai_relevant: nextShown }
                            : t));
                          try {
                            await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ kind: nextShown ? "relevant" : "noise" }),
                            });
                            loadCounts();
                          } catch {}
                        }}
                        aria-label={`AI relevance: ${thread.suppression_reason || thread.ai_relevant === false ? "marked hidden" : "marked relevant"}. Click to change.`}
                        title={`AI relevance: ${thread.suppression_reason || thread.ai_relevant === false ? "marked hidden" : "marked relevant"} · click to change`}
                        style={{ marginTop: 4, width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                          {thread.gmail_is_unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--accent)" }} />}
                          <strong style={{ fontSize: 15 }}>{thread.candidate_name}</strong>
                          <span style={{ fontSize: 13, color: "var(--muted)" }}>{thread.forwarded_candidate_reply ? "Candidate sent · forwarded" : thread.direction === "outbound" ? "Shared mailbox sent" : thread.from_email || "Unknown sender"}</span>
                          {thread.message_count > 1 && <span className="badge" style={{ background: "var(--bg-inset)" }}>{thread.message_count} msgs</span>}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.subject || "(no subject)"}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.snippet || thread.ai_summary || "No preview available."}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          {thread.ai_category && <span className="badge">{categoryLabel(thread.ai_category)}</span>}
                          {thread.forwarded_candidate_reply ? <span className="badge" style={{ background: "#14532d", color: "#bbf7d0", border: "1px solid #16a34a" }}>Forwarded team reply</span> : thread.needs_reply && !thread.effective_replied_at && !thread.detected_replied_at ? (() => {
                            const age = (Date.now() - new Date(thread.sent_at).getTime()) / 3_600_000;
                            return age >= 24 && age <= 168 ? <PriorityBadge level="urgent" label="Overdue · 24h+" /> : age > 168 ? <PriorityBadge level="normal" label="Needs reply · older" /> : <span className="badge" style={{ background: age >= 12 ? "#172554" : "#2e1065", color: age >= 12 ? "#bfdbfe" : "#ddd6fe", border: `1px solid ${age >= 12 ? "#2563eb" : "#7c3aed"}` }}>{age >= 12 ? "Waiting · 12h+" : "Needs reply"}</span>;
                          })() : (thread.effective_replied_at || thread.detected_replied_at) ? <span className="badge" style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" }}>{thread.manual_replied_at ? "Marked replied" : "Team replied"} · {formatDate(thread.effective_replied_at || thread.detected_replied_at)}</span> : thread.direction === "inbound" ? <span className="badge" style={{ background: "#1e293b", color: "#cbd5e1", border: "1px solid #475569" }}>No reply needed</span> : null}
                          {thread.open_task_count > 0 && <span className="badge">{thread.open_task_count} open tasks</span>}
                          {(thread.suppression_reason || thread.ai_relevant === false) && <span className="badge" style={{ background: "#292331", color: "#d8b4fe", border: "1px solid #6b21a8" }}>AI marked hidden</span>}
                        </div>
                      </div>
                      <div className="inbox-thread-actions" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                        <time className="inbox-thread-time" style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(thread.sent_at)}</time>
                        <button
                          type="button"
                          className="btn outline sm"
                          onClick={(event) => { event.stopPropagation(); setSelectedThread(thread); }}
                          aria-label={`Show details for ${thread.subject || "email"}`}
                        >
                          Show details
                        </button>
                        {thread.needs_reply && !thread.effective_replied_at && !thread.detected_replied_at && <>
                          <button type="button" className="btn-primary sm" onClick={(event) => { event.stopPropagation(); void markThreadReplied(thread); }}>Mark replied</button>
                          <button type="button" className="btn outline sm inbox-no-reply-button" onClick={(event) => { event.stopPropagation(); void markThreadNoReplyNeeded(thread); }}>No reply needed</button>
                        </>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {renderPagination({ marginTop: 12, marginBottom: 12 })}
          </div>

          {selectedThread && (
            <EmailActionModal
              thread={selectedThread}
              candidates={candidates}
              onClose={() => setSelectedThread(null)}
              onUpdated={() => {
                loadThreads(page);
                loadCounts();
              }}
            />
          )}
        </>
      )}

      {/* UNASSIGNED TAB */}
      {activeTab === "unassigned" && (
        <UnassignedPanel candidates={candidates} onAssigned={() => { loadCounts(); loadThreads(page); }} />
      )}

      {/* HANDOVERS TAB */}
      {activeTab === "handovers" && (
        <div>
          <div className="inbox-filter-box" style={{ padding: "8px 10px", marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "var(--surface-2, #1a1a2e)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <strong style={{ fontSize: 12 }}>Filter handovers</strong>
            <select className="input" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} aria-label="Filter handovers by candidate" style={{ minWidth: 220 }}>
              <option value="">All candidates</option>
              {[...candidates].sort((a, b) => a.name.localeCompare(b.name)).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </div>
          {loadingHandovers ? <div className="text-muted">Loading handovers...</div> : handovers.length === 0 ? <div className="text-muted">No handovers assigned to you.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {handovers.map(h => (
                <div key={h.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <PriorityBadge level={h.priority} />
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>{h.status}</span>
                    </div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{h.title}</h3>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{h.description || "No note provided."}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Assigned {new Date(h.created_at).toLocaleString()}</div>
                  </div>
                  {h.status !== "done" && (
                    <button className="btn outline sm" onClick={() => handleUpdateHandover(h.id, "done")}>Mark Done</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
