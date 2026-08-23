"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ApprovalsPanel from "./components/ApprovalsPanel";
import { CandidateGmailSelector } from "./components/CandidateGmailSelector";
import { PriorityBadge } from "./components/PriorityBadge";
import EmailActionModal from "./components/EmailActionModal";
import EmailTaskRow, { type EmailTask } from "./components/EmailTaskRow";

type Direction = "inbox" | "sent" | "all";
type PageTab = "inbox" | "approvals" | "drafts" | "handovers";

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

interface InboxCounts {
  approvals: { pending: number; urgent: number; approvedToday: number; rejectedToday: number };
  tasks: { needsReply: number; interviews: number; untracked: number; conflicts: number; escalated: number };
  mail: { relevant: number; awaitingReply: number; hidden: number; total: number; lastMessageAt: string | null };
  drafts: { total: number };
  handovers: { assigned: number; overdue: number };
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
  const [activeTab, setActiveTab] = useState<PageTab>("inbox");
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  
  // Inbox state
  const [direction, setDirection] = useState<Direction>("inbox");
  const [search, setSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [gmailCandidateId, setGmailCandidateId] = useState("");
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [candidatesError, setCandidatesError] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesRetryKey, setCandidatesRetryKey] = useState(0);
  const [category, setCategory] = useState("");
  const [needsReply, setNeedsReply] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [clearanceOnly, setClearanceOnly] = useState(false);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  
  // Global state
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  
  // Tasks state
  const [tasks, setTasks] = useState<EmailTask[]>([]);
  
  // Drafts state
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  
  // Handovers state
  const [handovers, setHandovers] = useState<any[]>([]);
  const [loadingHandovers, setLoadingHandovers] = useState(false);

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
    if (activeTab !== "inbox") return;
    setLoading(true);
    const params = new URLSearchParams({ direction, page: String(nextPage), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (!showHidden) params.set("relevant", "true");
    if (clearanceOnly) params.set("clearanceOnly", "true");
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
  }, [direction, search, candidateId, category, needsReply, showHidden, clearanceOnly, activeTab]);

  const loadDraftsData = useCallback(async () => {
    if (activeTab !== "drafts") return;
    setLoadingDrafts(true);
    try {
      const res = await fetch("/api/inbox/drafts", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDrafts(data.drafts || []);
    } catch (e) {} finally {
      setLoadingDrafts(false);
    }
  }, [activeTab]);

  const loadHandoversData = useCallback(async () => {
    if (activeTab !== "handovers") return;
    setLoadingHandovers(true);
    try {
      const res = await fetch("/api/inbox/handover", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setHandovers(data.handovers || []);
    } catch (e) {} finally {
      setLoadingHandovers(false);
    }
  }, [activeTab]);

  const refreshThreadsInPlace = useCallback(async () => {
    if (loading || activeTab !== "inbox") return;
    const params = new URLSearchParams({ direction, page: String(page), pageSize: "25" });
    if (search.trim()) params.set("search", search.trim());
    if (candidateId) params.set("candidateId", candidateId);
    if (category) params.set("category", category);
    if (needsReply) params.set("needsReply", "true");
    if (!showHidden) params.set("relevant", "true");
    if (clearanceOnly) params.set("clearanceOnly", "true");
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
    } catch {}
  }, [direction, search, candidateId, category, needsReply, showHidden, clearanceOnly, page, loading, activeTab]);

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

  useEffect(() => {
    fetch("/api/integrations/gmail/candidate-status")
      .then((res) => res.json())
      .then((data) => {
        if (data.connected_candidates) {
          setConnectedIds(new Set(data.connected_candidates));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadThreads(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);
  
  useEffect(() => { loadDraftsData(); }, [loadDraftsData]);
  useEffect(() => { loadHandoversData(); }, [loadHandoversData]);

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
      setMessage("Gmail sync completed.");
      await Promise.all([loadThreads(1), loadCounts(), loadTasks()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gmail sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const handleDeleteDraft = async (id: string) => {
    if (!confirm("Delete draft?")) return;
    await fetch(`/api/inbox/drafts?id=${id}`, { method: "DELETE" });
    loadDraftsData();
    loadCounts();
  };

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
    <div className="page" style={{ maxWidth: "100%", margin: "0 auto", padding: "28px 20px 48px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
        <h1 style={{ margin: "6px 0 4px" }}>Candidate Inbox</h1>
        <p className="page-kicker" style={{ margin: 0 }}>Recruiting email, AI findings, application matches, and AE follow-up in one place.</p>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch", marginBottom: 28 }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <CandidateGmailSelector
            candidates={candidates}
            value={gmailCandidateId}
            onChange={setGmailCandidateId}
          />
          {candidatesLoading && candidates.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Loading candidates…</div>
          )}
          {candidatesError && (
            <div style={{ fontSize: 12, color: "var(--danger, #dc2626)", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
              Couldn't load candidates.
              <button className="btn text sm" onClick={() => setCandidatesRetryKey((k) => k + 1)}>Retry</button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 320, background: "var(--surface-2, #1a1a2e)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Filter inbox & tasks</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Show mail and handovers for a specific candidate.</div>
          <select
            style={{ width: "100%", background: "var(--bg, #111)", color: "var(--ink)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
          >
            <option value="">All candidates</option>
            {[...candidates].sort((a, b) => {
              const aConn = connectedIds.has(a.id);
              const bConn = connectedIds.has(b.id);
              if (aConn && !bConn) return -1;
              if (!aConn && bConn) return 1;
              return a.name.localeCompare(b.name);
            }).map((c) => (
              <option key={c.id} value={c.id}>
                {connectedIds.has(c.id) ? "🟢 " : ""}{c.name}{connectedIds.has(c.id) ? " (Connected)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        <button 
          className={`btn text ${activeTab === "inbox" ? "active" : ""}`} 
          style={{ borderBottom: activeTab === "inbox" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("inbox")}
        >
          Inbox {counts?.mail.relevant ? `(${counts.mail.relevant})` : ""}
        </button>
        <button 
          className={`btn text ${activeTab === "approvals" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "approvals" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("approvals")}
        >
          Approvals {counts?.approvals.pending ? `(${counts.approvals.pending})` : ""}
        </button>
        <button 
          className={`btn text ${activeTab === "drafts" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "drafts" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("drafts")}
        >
          Drafts {counts?.drafts?.total ? `(${counts.drafts.total})` : ""}
        </button>
        <button 
          className={`btn text ${activeTab === "handovers" ? "active" : ""}`}
          style={{ borderBottom: activeTab === "handovers" ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 0, paddingBottom: 12 }}
          onClick={() => setActiveTab("handovers")}
        >
          My Handovers {counts?.handovers?.assigned ? `(${counts.handovers.assigned})` : ""}
        </button>
      </div>

      {message && <div className="alert success" style={{ marginBottom: 20 }}>{message}<button className="alert-close" onClick={() => setMessage("")}>×</button></div>}

      {/* INBOX TAB */}
      {activeTab === "inbox" && (
        <>
          <div style={{ padding: "10px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--surface-2, #1a1a2e)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 2, background: "var(--bg, #111)", borderRadius: 7, padding: 3, border: "1px solid var(--border)" }}>
              {(["inbox", "sent", "all"] as Direction[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDirection(tab)}
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
                  {tab === "inbox" ? "Inbox" : tab === "sent" ? "Sent" : "All mail"}
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
            <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
            </select>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }}>
              <input type="checkbox" checked={needsReply} onChange={(event) => setNeedsReply(event.target.checked)} /> Needs reply
            </label>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }} title="Include mail filtered out by the AI">
              <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> Show hidden
            </label>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }} title="Only mail matched to a federal job or one requiring security clearance">
              <input type="checkbox" checked={clearanceOnly} onChange={(event) => setClearanceOnly(event.target.checked)} /> Federal / clearance jobs
            </label>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "0 4px", display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
              <span>{total.toLocaleString()} conversations</span>
              <span>{showHidden ? "Showing hidden mail too." : "Hidden mail is not shown."}</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center" }} className="text-muted">Loading mailbox…</div>
            ) : threads.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }} className="text-muted">No conversations match these filters.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {threads.map((thread) => (
                  <div key={thread.id} onClick={() => setSelectedThread(thread)} style={{ width: "100%", textAlign: "left", padding: "16px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }} className="hover:border-[var(--accent)] hover:shadow-sm">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                          {thread.gmail_is_unread && <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--accent)" }} />}
                          <strong style={{ fontSize: 15 }}>{thread.candidate_name}</strong>
                          <span style={{ fontSize: 13, color: "var(--muted)" }}>{thread.direction === "outbound" ? "Sent" : thread.from_email || "Unknown sender"}</span>
                          {thread.message_count > 1 && <span className="badge" style={{ background: "var(--bg-inset)" }}>{thread.message_count} msgs</span>}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.subject || "(no subject)"}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread.snippet || thread.ai_summary || "No preview available."}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          {thread.ai_category && <span className="badge">{categoryLabel(thread.ai_category)}</span>}
                          {thread.needs_reply && <PriorityBadge level="high" label="Needs Reply" />}
                          {thread.open_task_count > 0 && <span className="badge">{thread.open_task_count} open tasks</span>}
                          {thread.suppression_reason && <span className="badge">Hidden by filters</span>}
                        </div>
                      </div>
                      <time style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(thread.sent_at)}</time>
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

      {/* APPROVALS TAB */}
      {activeTab === "approvals" && (
        <ApprovalsPanel candidateId={candidateId} />
      )}

      {/* DRAFTS TAB */}
      {activeTab === "drafts" && (
        <div>
          {loadingDrafts ? <div className="text-muted">Loading drafts...</div> : drafts.length === 0 ? <div className="text-muted">No drafts found.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {drafts.map(d => (
                <div key={d.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{d.subject || "(No subject)"}</h3>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>To: {d.to_email}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Saved {new Date(d.created_at).toLocaleString()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn text sm" style={{ color: "var(--danger)" }} onClick={() => handleDeleteDraft(d.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HANDOVERS TAB */}
      {activeTab === "handovers" && (
        <div>
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
