"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { openFaloodStudio } from "@/lib/falood/openStudio";
import { formatScoreOutOfTen, formatPageFitSummary } from "@/lib/scoreScale";

interface PageFitMetrics {
  pageCount: number;
  contentUtilization: number;
  bottomWhitespaceInches: number;
  overflow: boolean;
  readable: boolean;
  recommendation: "pass" | "trim" | "expand" | "manual_review";
}

interface QueueItem {
  id: string;
  app_number: number | null;
  status: string;
  assigned_by: string | null;
  assigned_to: string | null;
  assigned_by_user_id: string | null;
  assigned_to_user_id: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  review_status: "not_required" | "pending" | "approved" | "changes_requested";
  review_note: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  completed_at: string | null;
  next_action: string | null;
  proof_url: string | null;
  proof_filename: string | null;
  proof_uploaded_at: string | null;
  source_type: string | null;
  ae_stage: "in_ai_pipeline" | "ready_for_review" | "ready_for_application" | "applied";
  ae_stage_updated_at: string | null;
  ae_stage_updated_by_name: string | null;
  ae_reviewed_by_name: string | null;
  ae_reviewed_at: string | null;
  ae_applied_by_name: string | null;
  ae_applied_at: string | null;
  candidates: { id: string; name: string; email: string | null; phone: string | null; resume_url: string | null; resume_filename: string | null; candidate_number: number | null; avatar_url: string | null } | null;
  jobs: { id: string; title: string; company: string | null; location: string | null; source_url: string | null; job_category: string | null; category_relevance_score: number | null; job_number: number | null } | null;
  workflow_status?: string | null;
  workflow_id?: string | null;
  workflow_stage?: number | null;
  workflow_score?: number | null;
  hiring_panel_ats_score?: number | null;
  hiring_panel_recruiter_score?: number | null;
  hiring_panel_role_fit_score?: number | null;
  hiring_panel_truth_score?: number | null;
  average_score?: number | null;
  one_page_fit_score?: number | null;
  page_fit_metrics?: PageFitMetrics | null;
  workflow_resume_version_id?: string | null;
  workflow_resume_title?: string | null;
  base_resume_id?: string | null;
  resume_generation_status?: string | null;
}

interface TeamUser {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
}

interface QueueStats {
  all: number;
  mine: number;
  pendingAeReview: number;
  pendingAeApplication: number;
  aiPipeline: number;
}

type TabView = "all" | "mine" | "ae_review" | "ae_application" | "workflow";

const STATUS_ICONS: Record<string, string> = {
  assigned: "📋",
  stacked: "📚",
  in_progress: "🔨",
  applied: "✅",
};

function openCopilotForApplication(item: QueueItem) {
  const sourceUrl = item.jobs?.source_url;
  if (!sourceUrl) {
    alert("This application log has no external application URL yet. Add the ATS URL to open Copilot.");
    return;
  }
  const url = new URL(sourceUrl, window.location.origin);
  url.hash = `talentos_application_id=${encodeURIComponent(item.id)}`;
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

// AE hand-off funnel, replacing the old one-way "✅ Applied" button. Both AEs
// and managers can move a ticket between any of these (see PATCH /api/applications/[id]),
// which auto-advances in_ai_pipeline -> ready_for_review on its own once Final
// Polish finishes; the rest is a manual toggle either role can drive.
const AE_STAGE_LABELS: Record<string, string> = {
  in_ai_pipeline: "🤖 In AI Pipeline",
  ready_for_review: "🔍 Ready for AE Review",
  ready_for_application: "📤 Ready for AE Application",
  applied: "✅ AE Applied",
};

const AE_STAGE_STYLES: Record<string, { background: string; border: string; color: string }> = {
  in_ai_pipeline: { background: "rgba(139,92,246,0.16)", border: "rgba(139,92,246,0.55)", color: "#c4b5fd" },
  ready_for_review: { background: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.55)", color: "#fbbf24" },
  ready_for_application: { background: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.55)", color: "#7dd3fc" },
  applied: { background: "rgba(16,185,129,0.16)", border: "rgba(16,185,129,0.55)", color: "#6ee7b7" },
};

// Drag-to-resize column widths (persisted to localStorage) — order here
// must match the <colgroup>/<th> order in the table below.
// v2: the four single-ID columns were merged into two labeled ID columns, and
// the remaining widths were rebalanced so the whole table fits a standard
// desktop without a horizontal scrollbar at readable (non-shrunken) text
// sizes. Bumping the key retires any v1 widths saved against the old column
// set, which would otherwise pin users to the previous cramped layout.
const COLUMN_WIDTHS_STORAGE_KEY = "aq-column-widths-v2";
const MIN_COLUMN_WIDTH = 50;
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  checkbox: 32,
  candidate: 205,
  job: 205,
  status: 100,
  aiPipeline: 158,
  score: 100,
  stage: 200,
  owner: 120,
  due: 78,
  ticketJobIds: 162,
  resumeIds: 162,
  actions: 208,
};
const COLUMN_ORDER = [
  "checkbox", "candidate", "job", "status", "aiPipeline", "score", "stage", "owner", "due",
  "ticketJobIds", "resumeIds", "actions",
];

/** Thin draggable strip pinned to a <th>'s right edge. Mouse-drag only
 *  (matches this app's desktop-oriented admin-tool scope elsewhere). */
function ColumnResizeHandle({ columnId, currentWidth, onResize }: { columnId: string; currentWidth: number; onResize: (id: string, width: number) => void }) {
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentWidth;
    function onMouseMove(ev: MouseEvent) {
      onResize(columnId, startWidth + (ev.clientX - startX));
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
  return (
    <span
      onMouseDown={onMouseDown}
      title="Drag to resize column"
      style={{
        position: "absolute", top: 0, right: -3, bottom: 0, width: 6,
        cursor: "col-resize", userSelect: "none", zIndex: 1,
      }}
    />
  );
}

// current_stage is 0-indexed into APPLICATION_AGENT_IDS (job_lens, resume_forge,
// hiring_panel, final_polish) - it names the stage currently running/about to
// run, not a count of completed stages. Confirmed live: this table previously
// shifted every label by one (stage 1 shown as "Job Lens" while the actual
// stage_run row was already application_resume_forge), making the whole batch
// look stuck a step earlier than it actually was. "Queued" isn't a stage at
// all - that's conveyed by the separate wfStatus badge next to this label.
const WORKFLOW_LABELS: Record<number, string> = {
  0: "🔍 Job Lens",
  1: "📝 Resume Forge",
  2: "👥 Hiring Panel",
  3: "✨ Final Polish",
};

// same convention as src/app/candidates/page.tsx -- keep in sync if that one changes
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

/** One labeled ID row with an explicit copy button (rather than a bare
 *  click-anywhere-to-copy span) so the copy action is actually discoverable. */
function CopyableId({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return (
      <div className="id-pair-row">
        <span className="id-pair-label">{label}</span>
        <span className="text-muted" style={{ fontSize: 12 }}>—</span>
      </div>
    );
  }
  return (
    <div className="id-pair-row">
      <span className="id-pair-label">{label}</span>
      <span className="id-pair-value" title={value}>{value.slice(0, 8)}…</span>
      <button
        type="button"
        className={copied ? "id-pair-copy copied" : "id-pair-copy"}
        title={`Copy ${label} ID`}
        aria-label={`Copy ${label} ID`}
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

export default function ApplicationQueuePage() {
  const loadRequestRef = useRef(0);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [me, setMe] = useState<{ profile: { user_id: string; role: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<QueueStats>({ all: 0, mine: 0, pendingAeReview: 0, pendingAeApplication: 0, aiPipeline: 0 });
  const [statusFilter, setStatusFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [viewFilter, setViewFilter] = useState<TabView>("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [timeWindow, setTimeWindow] = useState("");
  const [sort, setSort] = useState<"due" | "final_score" | "average_score">("due");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filterCandidates, setFilterCandidates] = useState<{ id: string; name: string }[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [editing, setEditing] = useState<QueueItem | null>(null);

  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, any>>({});
  const [faloodOpen, setFaloodOpen] = useState<string | null>(null);
  const [faloodResumes, setFaloodResumes] = useState<Record<string, any[]>>({});

  // Per-user drag-resizable column widths, persisted so the layout survives
  // a reload. Loaded client-side only (localStorage isn't available during
  // SSR) - starts from defaults, then overridden once mounted if a saved
  // set exists.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_COLUMN_WIDTHS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (saved) setColumnWidths((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch { /* ignore corrupt/unavailable storage */ }
  }, []);
  function resizeColumn(id: string, nextWidth: number) {
    setColumnWidths((prev) => {
      const next = { ...prev, [id]: Math.max(MIN_COLUMN_WIDTH, Math.round(nextWidth)) };
      try { localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function buildParams(pn: number) {
    const p = new URLSearchParams();
    p.set("page", String(pn));
    p.set("pageSize", String(pageSize));
    if (search) p.set("search", search);
    if (candidateFilter) p.set("candidate_id", candidateFilter);
    if (statusFilter) p.set("status", statusFilter);
    if (stageFilter) p.set("stage", stageFilter);
    if (ownerFilter) p.set("owner", ownerFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    if (reviewFilter) p.set("review", reviewFilter);
    if (viewFilter !== "all") p.set("view", viewFilter);
    if (timeWindow) p.set("time_window", timeWindow);
    if (sort !== "due") {
      p.set("sort", sort);
      p.set("direction", sortDirection);
    }
    return p;
  }

  // isBackgroundPoll = true means this load was triggered by the silent
  // auto-poll below, not a real filter change or user action - it must not
  // clobber whatever the user currently has open (selections, expanded
  // workflow row, Falood panel), or every poll tick collapses their UI.
  async function load(pn: number = page, clearFeedback = true, isBackgroundPoll = false) {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    if (clearFeedback) setFeedback(null);
    try {
      const [queueRes, usersRes, meRes] = await Promise.all([
        fetch(`/api/application-queue?${buildParams(pn)}`, { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      if (!queueRes.ok) throw new Error("Could not load queue.");
      const data = await queueRes.json();
      if (requestId !== loadRequestRef.current) return;
      const newTotal = data.total ?? 0;
      const tp = Math.max(1, Math.ceil(newTotal / pageSize));
      if (pn > tp && pn > 1) { setLoading(false); return load(tp); }
      setItems(data.items ?? []);
      setTotal(newTotal);
      setStats(data.stats ?? { all: 0, mine: 0, pendingAeReview: 0, pendingAeApplication: 0, aiPipeline: 0 });
      if (usersRes.ok) setUsers(await usersRes.json());
      if (meRes.ok) setMe(await meRes.json());
      if (!isBackgroundPoll) {
        setSelected(new Set());
        setFaloodOpen(null);
        setExpandedWorkflow(null);
        setWorkflowDetails({});
        setFaloodResumes({});
      }
      setPage(pn);
    } catch (err: any) {
      if (requestId === loadRequestRef.current) setFeedback({ kind: "error", text: err.message || "Load failed." });
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/candidates?compact=1&pageSize=500")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFilterCandidates(Array.isArray(data) ? data : (data.items ?? [])))
      .catch(console.error);
  }, []);

  useEffect(() => { load(1); }, [search, candidateFilter, statusFilter, stageFilter, ownerFilter, priorityFilter, reviewFilter, viewFilter, timeWindow, sort, sortDirection, pageSize]);

  // Lightweight live-update: instead of re-fetching the whole queue (which
  // resets scroll/selection and feels like a page reload), poll just the
  // active-workflows list and patch matching rows in place by workflow_id.
  // This is also what nudges genuinely stuck workflows forward — see
  // /api/application-ai-workflows/active's own opportunistic-dispatch
  // comment: a burst of tickets created together can sit at
  // status='queued' indefinitely with nothing else to drive them, since
  // the in-process chain-dispatch between stages doesn't reliably survive
  // on Cloudflare Workers and the GitHub Actions cron safety net has been
  // observed running 30-40 minutes apart instead of ~5. Anyone with this
  // page open becomes a much faster safety net than the cron gap.

  useEffect(() => {
    const interval = setInterval(async () => {
      // Previously gated on itemsRef already showing an active
      // workflow_status before even asking the server - a stale/incomplete
      // initial snapshot (e.g. applications created via a different flow,
      // or a race between application creation and this page's load) meant
      // the poller silently never checked at all. Always poll instead; the
      // request is cheap and this is what actually finds newly-queued work.
      try {
        const res = await fetch("/api/application-ai-workflows/active", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();

        // Server-side self-dispatch (the Worker fetching its own URL from
        // within this same GET request) is unreliable in production -
        // confirmed live, a batch of workflows sat queued for 5+ minutes
        // despite this exact polling running the whole time. A real
        // client-initiated POST never failed once in the same testing, so
        // fire it directly instead of hoping the server-side one landed.
        if (data.needsDispatch) {
          fetch("/api/application-ai-workflows/dispatch", { method: "POST" }).catch(() => {});
        }

        const byWorkflowId = new Map((data.workflows ?? []).map((w: any) => [w.id, w]));

        const justCompleted: QueueItem[] = [];
        setItems((prev) =>
          prev.map((item) => {
            if (!item.workflow_id) return item;
            const wf: any = byWorkflowId.get(item.workflow_id);
            if (!wf) return item;
            const wasActive = item.workflow_status === "queued" || item.workflow_status === "running";
            const nowTerminal = wf.status === "completed" || wf.status === "failed" || wf.status === "cancelled";
            if (wasActive && nowTerminal) justCompleted.push(item);
            return {
              ...item,
              workflow_status: wf.status,
              workflow_stage: wf.current_stage,
              workflow_score: wf.match_score ?? item.workflow_score,
            };
          })
        );

        // A workflow that just finished needs its application row re-read
        // (resume_generation_status, tailored_resume_version_id, proof
        // fields aren't on the active-workflows list) - fetched per-row so
        // only that card updates, not the whole grid.
        for (const item of justCompleted) {
          fetch(`/api/applications/${item.id}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => {
              if (!fresh) return;
              setItems((prev) =>
                prev.map((it) =>
                  it.id === item.id
                    ? {
                        ...it,
                        resume_generation_status: fresh.resume_generation_status,
                        workflow_resume_version_id: fresh.tailored_resume_version_id ?? it.workflow_resume_version_id,
                      }
                    : it
                )
              );
            })
            .catch(() => {});
        }
      } catch {}
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const ownerLabel = (item: QueueItem) => {
    const u = item.assigned_to_user_id ? userMap.get(item.assigned_to_user_id) : null;
    return u?.display_name || u?.email || item.assigned_to || "Unassigned";
  };
  const assignmentOwners = [...users].sort((a, b) => ((a.role === "application_engineer" ? 0 : 1) - (b.role === "application_engineer" ? 0 : 1)) || (a.display_name || "").localeCompare(b.display_name || ""));
  
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goToPage(inputVal: string) {
    const n = parseInt(inputVal);
    if (isNaN(n) || n < 1) {
      setPageError("Enter a valid page number");
      return;
    }
    if (n > totalPages) {
      setPageError(`Page must be 1–${totalPages}`);
      return;
    }
    setPageError("");
    setPageInput("");
    load(n);
  }

  function renderPagination(options: { marginTop: number; marginBottom: number }) {
    if (total <= 0) return null;
    return (
      <div className="filter-bar" style={{ justifyContent: "center", alignItems: "center", gap: 6, marginTop: options.marginTop, marginBottom: options.marginBottom }}>
        <button className="btn-compact" onClick={() => load(page - 1)} disabled={loading || page <= 1}>Prev</button>
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
              className={`btn-compact ${entry === page ? "btn-primary" : ""}`}
              onClick={() => typeof entry === "number" && entry !== page ? load(entry) : undefined}
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
        <button className="btn-compact" onClick={() => load(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        <span className="text-muted" style={{ marginLeft: 16, fontSize: 13 }}>Page</span>
        <input
          className="input"
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => { setPageInput(e.target.value); setPageError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") goToPage(pageInput); }}
          placeholder={`1–${totalPages}`}
          style={{ width: 70, padding: "5px 8px", fontSize: 13 }}
        />
        <button className="btn-compact" onClick={() => goToPage(pageInput)} style={{ padding: "5px 12px", fontSize: 13 }}>Go</button>
        {pageError && <span className="form-error" style={{ fontSize: 12, marginLeft: 6 }}>{pageError}</span>}
      </div>
    );
  }
  const selectedItems = items.filter(i => selected.has(i.id));
  const today = new Date().toISOString().slice(0, 10);
  const isManager = ["admin", "manager"].includes(me?.profile?.role ?? "");

  function toggleOne(id: string) {
    setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(p => p.size === items.length ? new Set() : new Set(items.map(i => i.id)));
  }

  async function setStatus(id: string, s: string) {
    setActionLoading(`${id}:${s}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ application_stage: s, ...(s === "applied" ? { ae_stage: "applied" } : {}), completed_at: s === "applied" ? new Date().toISOString() : null, event_note: s === "applied" ? "Submitted from queue." : null }) });
      setActionLoading(null);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFeedback({ kind: "error", text: d.error || "Update failed." }); return; }
      setFeedback({ kind: "success", text: s === "applied" ? "Marked applied." : "Updated." });
      load(page, false);
    } catch (err: any) { setActionLoading(null); setFeedback({ kind: "error", text: err.message || "Network error." }); }
  }

  async function changeAeStage(id: string, stage: string) {
    setActionLoading(`${id}:ae_stage`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ae_stage: stage }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setActionLoading(null); setFeedback({ kind: "error", text: d.error || "Update failed." }); return; }
      const updated = await res.json().catch(() => null);
      setItems((prev) => prev.map((item) => item.id === id ? {
        ...item,
        ae_stage: updated?.ae_stage ?? stage,
        status: updated?.status ?? item.status,
        applied_at: updated && Object.prototype.hasOwnProperty.call(updated, "applied_at") ? updated.applied_at : item.applied_at,
        completed_at: updated && Object.prototype.hasOwnProperty.call(updated, "completed_at") ? updated.completed_at : item.completed_at,
        ae_stage_updated_at: updated?.ae_stage_updated_at ?? item.ae_stage_updated_at,
        ae_stage_updated_by_name: updated?.ae_stage_updated_by_name ?? item.ae_stage_updated_by_name,
        ae_applied_at: updated?.ae_applied_at ?? item.ae_applied_at,
        ae_applied_by_name: updated?.ae_applied_by_name ?? item.ae_applied_by_name,
      } : item));
      setActionLoading(null);
      setFeedback({ kind: "success", text: `Moved to "${AE_STAGE_LABELS[stage] ?? stage}".` });
      load(page, false);
    } catch (err: any) { setActionLoading(null); setFeedback({ kind: "error", text: err.message || "Network error." }); }
  }

  async function requestReview(item: QueueItem) {
    setActionLoading(`${item.id}:review`);
    try {
      const res = await fetch(`/api/applications/${item.id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review_status: "pending", review_note: item.review_note ?? "Ready for review.", event_note: "Sent for review." }) });
      setActionLoading(null);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFeedback({ kind: "error", text: d.error || "Review request failed." }); return; }
      setFeedback({ kind: "success", text: "Sent for review." });
      load(page, false);
    } catch (err: any) { setActionLoading(null); setFeedback({ kind: "error", text: err.message }); }
  }

  async function startWorkflow(item: QueueItem) {
    setActionLoading(`${item.id}:workflow`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/applications/${item.id}/ai-workflow`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFeedback({ kind: "error", text: d.error || "Workflow start failed." });
        return;
      }
      const data = await res.json();
      setFeedback({ kind: "success", text: `AI pipeline started: ${data.workflowId}` });
      load(page, false);
    } catch (err: any) { setFeedback({ kind: "error", text: err.message || "Network error" }); }
    finally { setActionLoading(null); }
  }

  // Restarts the full pipeline from stage 1 for an application that already
  // has a generated resume - a fresh run, not a continuation. See
  // regenerateAiWorkflowForApplication for why this hits a separate endpoint
  // instead of reusing startWorkflow's.
  async function regenerateWorkflow(item: QueueItem) {
    if (!confirm("Regenerate this resume? This restarts the full AI pipeline from scratch and replaces the current tailored resume.")) return;
    setActionLoading(`${item.id}:regenerate`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/applications/${item.id}/ai-workflow/regenerate`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFeedback({ kind: "error", text: d.error || "Regeneration failed." });
        return;
      }
      const data = await res.json();
      setFeedback({ kind: "success", text: `Regenerating from scratch: ${data.workflowId}` });
      load(page, false);
    } catch (err: any) { setFeedback({ kind: "error", text: err.message || "Network error" }); }
    finally { setActionLoading(null); }
  }

  async function fetchWorkflowDetails(item: QueueItem) {
    if (!item.workflow_id) return;
    if (workflowDetails[item.workflow_id]) {
      setExpandedWorkflow(expandedWorkflow === item.workflow_id ? null : item.workflow_id);
      return;
    }
    setExpandedWorkflow(item.workflow_id);
    try {
      const res = await fetch(`/api/application-ai-workflows/${item.workflow_id}?action=status`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setWorkflowDetails(p => ({ ...p, [item.workflow_id!]: data }));
      }
    } catch {}
  }


  async function uploadProof(item: QueueItem) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setActionLoading(`${item.id}:proof`);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/applications/${item.id}/proof`, { method: "POST", body: fd });
      setActionLoading(null);
      if (res.ok) { setFeedback({ kind: "success", text: "Proof uploaded." }); load(page, false); }
      else { setFeedback({ kind: "error", text: "Upload failed." }); }
    };
    input.click();
  }

  async function bulkStatus(s: string) {
    setFeedback(null);
    try {
      const res = await fetch("/api/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PATCH",
          table: "applications",
          ids: Array.from(selectedItems).map(i => i.id),
            updateData: { application_stage: s, ...(s === "applied" ? { ae_stage: "applied" } : {}), completed_at: s === "applied" ? new Date().toISOString() : null }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setFeedback({ kind: "error", text: data.error || "Bulk update failed." });
        return;
      }
      setFeedback({ kind: data.failed ? "error" : "success", text: data.failed ? `${data.updated} updated; ${data.failed} failed.` : `${data.updated} applications updated.` });
      setSelected(new Set());
      load(page, false);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Network error." });
    }
  }

  async function bulkReassign() {
    if (!bulkOwnerId) return;
    const owner = users.find(u => u.user_id === bulkOwnerId);
    try {
      const res = await fetch("/api/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PATCH",
          table: "applications",
          ids: Array.from(selectedItems).map(i => i.id),
          updateData: { assigned_to_user_id: bulkOwnerId, assigned_to: owner?.display_name || owner?.email || null }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setFeedback({ kind: "error", text: data.error || "Reassignment failed." });
        return;
      }
      setBulkOwnerId("");
      setFeedback({ kind: data.failed ? "error" : "success", text: data.failed ? `${data.updated} reassigned; ${data.failed} failed.` : `${data.updated} applications reassigned to ${owner?.display_name || owner?.email || "the selected owner"}.` });
      setSelected(new Set());
      load(page, false);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Network error." });
    }
  }

  async function bulkDelete() {
    if (!isManager || selected.size === 0) return;
    if (!confirm(`Permanently delete ${selected.size} selected application logs?`)) return;
    const res = await fetch("/api/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "DELETE", table: "applications", ids: Array.from(selected) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 207) { setFeedback({ kind: "error", text: data.error || "Bulk delete failed." }); return; }
    setSelected(new Set());
    setFeedback({ kind: data.failed ? "error" : "success", text: data.failed ? `${data.updated} deleted; ${data.failed} failed.` : `${data.updated} applications deleted.` });
    load(Math.min(page, Math.max(1, Math.ceil((total - data.updated) / pageSize))), false);
  }

  async function removeTicket(item: QueueItem) {
    if (!confirm(`Remove ${item.candidates?.name ?? "this ticket"}?`)) return;
    const res = await fetch(`/api/applications/${item.id}`, { method: "DELETE" });
    if (res.ok) { setFeedback({ kind: "success", text: "Removed." }); load(page, false); }
    else { 
      const d = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: d.error || "Remove failed." }); 
    }
  }

  function openFaloodDropdown(item: QueueItem) {
    if (!item.candidates) return;
    setFaloodOpen(item.id);
    if (!faloodResumes[item.candidates.id]) {
      fetch(`/api/base-resumes?candidateId=${item.candidates.id}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : [])
        .then(d => setFaloodResumes(p => ({ ...p, [item.candidates!.id]: d ?? [] })))
        .catch(() => {});
    }
  }

  async function buildBaseResume(item: QueueItem) {
    if (!item.candidates) return;
    setActionLoading(`${item.id}:build_base`);
    try {
      const res = await fetch("/api/base-resumes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: item.candidates.id, name: "Base Resume", targetIndustry: item.jobs?.job_category || "", targetRoles: item.jobs?.title ? [item.jobs.title] : [], startingSource: "blank" }) });
      if (res.ok) {
        const d = await res.json();
        setFaloodResumes(p => ({ ...p, [item.candidates!.id]: [...(p[item.candidates!.id] ?? []), d] }));
        setFeedback({ kind: "success", text: "Base resume created. Opening Studio…" });
        openFaloodStudio("base_resume", d.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setFeedback({ kind: "error", text: d.error || "Build failed." });
      }
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Network error." });
    } finally {
      setActionLoading(null);
      setFaloodOpen(null);
    }
  }

  function workflowStageLabel(stage: number | null | undefined): string {
    if (stage === null || stage === undefined) return "-";
    return WORKFLOW_LABELS[stage] || `Stage ${stage}`;
  }

  function dueClass(date: string | null) {
    if (!date) return "";
    if (date < today) return "overdue";
    if (date === today) return "today";
    return "";
  }

  const statTabs: { key: TabView; label: string; count: number }[] = [
    { key: "all", label: "All tickets", count: stats.all },
    { key: "mine", label: "Mine", count: stats.mine },
    { key: "ae_review", label: "AE Review pending", count: stats.pendingAeReview },
    { key: "ae_application", label: "AE Application pending", count: stats.pendingAeApplication },
    { key: "workflow", label: "AI Pipeline", count: stats.aiPipeline },
  ];

  return (
    <div className="app-queue-page">
      <div className="page-header">
        <div>
          <h1>Application Queue</h1>
          <div className="page-kicker">Assigned tickets, AI agent pipeline, and review gates.</div>
        </div>
        <div className="header-actions">
          <button className="btn-outline" onClick={() => load(page)} disabled={loading}>
            {loading ? "⟳" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`alert ${feedback.kind === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 12 }}>
          {feedback.text}
          <button className="alert-close" onClick={() => setFeedback(null)}>×</button>
        </div>
      )}

      <div className="stats-strip">
        {statTabs.map(t => (
          <button key={t.key} className={`stat-button ${viewFilter === t.key ? "active" : ""}`} onClick={() => setViewFilter(t.key)}>
            <span className="stat-label">{t.label}</span>
            <span className="stat-value">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <input className="input" placeholder="Search candidate, job, company..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <select className="input" value={candidateFilter} onChange={e => setCandidateFilter(e.target.value)}>
            <option value="">All candidates</option>
            {filterCandidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="assigned">Assigned</option>
            <option value="stacked">Stacked</option>
            <option value="in_progress">In progress</option>
          </select>
          <select className="input" value={stageFilter} onChange={e => setStageFilter(e.target.value)} aria-label="Filter by application stage">
            <option value="">All stages</option>
            {Object.entries(AE_STAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label.replace(/^[^ ]+ /, "")}</option>
            ))}
          </select>
          <select className="input" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="">All owners</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}>
            <option value="">All review</option>
            <option value="not_required">No review</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes requested</option>
          </select>
          <select className="input" value={timeWindow} onChange={e => setTimeWindow(e.target.value)} aria-label="Filter by recent application log time">
            <option value="">Any time</option>
            <option value="12h">Past 12 hours</option>
            <option value="24h">Past 24 hours</option>
            <option value="3d">Past 3 days</option>
            <option value="7d">Past 7 days</option>
          </select>
          <select
            className="input"
            value={sort}
            onChange={e => {
              const next = e.target.value as "due" | "final_score" | "average_score";
              setSort(next);
              setSortDirection(next === "due" ? "asc" : "desc");
            }}
            aria-label="Sort application queue"
          >
            <option value="due">Sort: due date</option>
            <option value="final_score">Sort: Final QA score</option>
            <option value="average_score">Sort: Average of all scores</option>
          </select>
          {sort !== "due" && (
            <button
              className="btn-compact"
              onClick={() => setSortDirection((d) => d === "desc" ? "asc" : "desc")}
              title="Change score ordering"
            >
              {sortDirection === "desc" ? "High → low" : "Low → high"}
            </button>
          )}
        </div>
        <span className="text-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{items.length} / {total}</span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} selected</span>
          <div className="bulk-actions">
            <button className="btn-compact" onClick={() => bulkStatus("in_progress")}>Start</button>
            <button className="btn-primary btn-compact" onClick={() => bulkStatus("applied")}>Mark applied</button>
            <select className="input" value={bulkOwnerId} onChange={e => setBulkOwnerId(e.target.value)} style={{ width: 200 }}>
              <option value="">Reassign to...</option>
              {assignmentOwners.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.display_name || u.email} ({u.role.replaceAll("_", " ")})</option>
              ))}
            </select>
            <button className="btn-compact" onClick={bulkReassign} disabled={!bulkOwnerId}>Go</button>
            {isManager && <button className="btn-compact" onClick={bulkDelete} style={{ borderColor: "#ef4444", color: "#fca5a5" }}>Delete selected</button>}
          </div>
        </div>
      )}

      {renderPagination({ marginTop: 0, marginBottom: 16 })}

      {loading ? (
        <div className="loading-panel" style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-soft)" }}>Loading...</div>
      ) : total === 0 ? (
        <div className="empty-state" style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-soft)" }}>No application tickets found.</div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {COLUMN_ORDER.map((id) => (
                <col key={id} style={{ width: columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {[
                  { id: "checkbox", label: <input type="checkbox" style={{ width: "auto" }} checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} /> },
                  { id: "candidate", label: "Candidate" },
                  { id: "job", label: "Job" },
                  { id: "status", label: "Status" },
                  { id: "aiPipeline", label: "AI Pipeline" },
                  { id: "score", label: "Scores" },
                  { id: "stage", label: "Stage" },
                  { id: "owner", label: "Owner" },
                  { id: "due", label: "Due" },
                  { id: "ticketJobIds", label: "Ticket / Job" },
                  { id: "resumeIds", label: "Resume IDs" },
                  { id: "actions", label: "Actions" },
                ].map((col) => (
                  <th key={col.id} style={{ position: "relative", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {col.label}
                    <ColumnResizeHandle columnId={col.id} currentWidth={columnWidths[col.id] ?? DEFAULT_COLUMN_WIDTHS[col.id]} onResize={resizeColumn} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={expandedWorkflow === item.id ? "row-expanded" : ""}>
                  <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                  
                  <td className="cell-main">
                    {item.candidates ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          {item.candidates.avatar_url ? (
                            <img className="avatar-circle" src={item.candidates.avatar_url} alt={item.candidates.name} />
                          ) : (
                            <span className="avatar-circle">{initials(item.candidates.name)}</span>
                          )}
                          <Link className="row-link" href={`/candidates/${item.candidates.id}`}>{item.candidates.name}</Link>
                        </div>
                        {(item.candidates.candidate_number != null || item.app_number != null) && (
                          <div className="ref-chip-row">
                            {item.candidates.candidate_number != null && (
                              <span className="ref-chip ref-chip-candidate" title={`Candidate number ${item.candidates.candidate_number}`}>C#{item.candidates.candidate_number}</span>
                            )}
                            {item.app_number != null && (
                              <span className="ref-chip" title={`Application number ${item.app_number}`}>A#{item.app_number}</span>
                            )}
                          </div>
                        )}
                        <div className="text-muted" style={{ fontSize: 12 }}>{item.candidates.email || item.candidates.phone || ""}</div>
                        <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                          {item.candidates.resume_url && <a href={item.candidates.resume_url} target="_blank" rel="noreferrer">Uploaded Resume</a>}
                        </div>
                      </>
                    ) : <span className="text-muted">—</span>}
                  </td>

                  <td className="cell-main">
                    {item.jobs ? (
                      <>
                        <Link className="row-link" href={`/jobs/${item.jobs.id}`}>{item.jobs.title}</Link>
                        {item.jobs.job_number != null && (
                          <div className="ref-chip-row">
                            <span className="ref-chip ref-chip-job" title={`Job number ${item.jobs.job_number}`}>J#{item.jobs.job_number}</span>
                          </div>
                        )}
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          {item.jobs.company || "—"} {item.jobs.location ? `• ${item.jobs.location}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                          {item.jobs.job_category && <span className="badge badge-info cell-category-badge">{item.jobs.job_category}</span>}
                          {item.jobs.source_url && !item.jobs.source_url.includes("example.com") && <a href={item.jobs.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Posting</a>}
                        </div>
                      </>
                    ) : <span className="text-muted">Ad-hoc</span>}
                  </td>

                  <td>
                    <span className={`badge badge-${item.status}`}>
                      {STATUS_ICONS[item.status] || ""} {item.status.replaceAll("_", " ")}
                    </span>
                  </td>

                  <td>
                    <PipelineActions item={item} actionLoading={actionLoading}
                      onStartWorkflow={startWorkflow}
                      onRegenerate={regenerateWorkflow}
                      onFetchDetails={fetchWorkflowDetails}
                      onReview={async (wfId: string, action: string) => {
                        setActionLoading(`${item.id}:${action}`);
                        try {
                          const res = await fetch(`/api/application-ai-workflows/${wfId}/review`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action }),
                          });
                          if (!res.ok) {
                            const d = await res.json().catch(() => ({}));
                            alert(d.error || `${action} failed`);
                          }
                        } catch (err: any) { alert(err.message); }
                        finally { setActionLoading(null); load(page, false); }
                      }}
                      expandedWorkflow={expandedWorkflow}
                      workflowDetails={workflowDetails}
                      workflowStageLabel={workflowStageLabel}
                    />
                    {expandedWorkflow === item.workflow_id && item.workflow_id && (
                      <div className="workflow-detail" style={{ marginTop: 8, padding: 8, background: "var(--surface-2)", borderRadius: 6, fontSize: 12 }}>
                        {item.workflow_status === "failed" && workflowDetails[item.workflow_id]?.workflow?.last_error && (
                          <div style={{ padding: 8, background: "rgba(211, 38, 30, 0.12)", color: "var(--danger)", borderRadius: 4 }}>
                            <strong>Error:</strong> {workflowDetails[item.workflow_id].workflow.last_error}
                          </div>
                        )}
                        {(item.workflow_stage ?? 0) >= 2 && (
                          <QueueFindingsPanel details={workflowDetails[item.workflow_id]} />
                        )}
                        <Link href="/resume-parsing-status" style={{ fontSize: 12, textDecoration: "underline", display: "inline-block", marginTop: 4 }}>
                          View full pipeline in Status page →
                        </Link>
                      </div>
                    )}
                  </td>

                  <td>
                    <QueueScoreCell item={item} />
                  </td>

                  <td>
                    <select
                      value={item.ae_stage}
                      disabled={actionLoading === `${item.id}:ae_stage`}
                      onChange={(e) => changeAeStage(item.id, e.target.value)}
                      title={item.ae_stage_updated_by_name ? `Last moved by ${item.ae_stage_updated_by_name}${item.ae_stage_updated_at ? " on " + new Date(item.ae_stage_updated_at).toLocaleString() : ""}` : undefined}
                      style={{
                        width: "100%", minWidth: 0, fontSize: 13, fontWeight: 700, padding: "8px 8px",
                        background: AE_STAGE_STYLES[item.ae_stage]?.background,
                        border: `1px solid ${AE_STAGE_STYLES[item.ae_stage]?.border}`,
                        color: AE_STAGE_STYLES[item.ae_stage]?.color,
                        borderRadius: 8,
                      }}
                    >
                      {/* No per-option background/color here on purpose: the dropdown
                          list is a native OS popup, not part of the page, and it
                          doesn't composite the translucent AE_STAGE_STYLES tints the
                          same way the closed control does — that left every option
                          except the selected one rendering as unreadable near-black
                          text on near-black. The global `select option` rule (solid
                          surface background + solid ink text) is reliably readable. */}
                      {Object.entries(AE_STAGE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    {item.ae_stage_updated_at && (
                      <div className="queue-stage-meta queue-stage-meta-changed">
                        Last changed {item.ae_stage_updated_by_name ? `by ${item.ae_stage_updated_by_name} ` : ""}on {new Date(item.ae_stage_updated_at).toLocaleString()}
                      </div>
                    )}
                    {item.ae_reviewed_by_name && (
                      <div className="queue-stage-meta queue-stage-meta-reviewed" title={item.ae_reviewed_at ? new Date(item.ae_reviewed_at).toLocaleString() : undefined}>
                        Reviewed by {item.ae_reviewed_by_name}
                      </div>
                    )}
                    {item.ae_applied_by_name && (
                      <div className="queue-stage-meta queue-stage-meta-applied" title={item.ae_applied_at ? new Date(item.ae_applied_at).toLocaleString() : undefined}>
                        Applied by {item.ae_applied_by_name}
                      </div>
                    )}
                  </td>

                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{ownerLabel(item)}</div>
                    {item.assigned_by && <div className="text-muted" style={{ fontSize: 12 }}>by {item.assigned_by}</div>}
                  </td>

                  <td className={item.assignment_due_at ? dueClass(item.assignment_due_at) : "text-muted"} style={{ fontSize: 13 }}>
                    {item.assignment_due_at ? new Date(item.assignment_due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </td>

                  <td>
                    <CopyableId label="Ticket" value={item.id} />
                    <CopyableId label="Job" value={item.jobs?.id ?? null} />
                  </td>
                  <td>
                    <CopyableId label="Base" value={item.base_resume_id ?? null} />
                    <CopyableId label="Tailored" value={item.workflow_resume_version_id ?? null} />
                  </td>

                  <td>
                    <div className="action-group" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(item.jobs?.source_url || item.id) && (
                        <button
                          className="btn-compact btn-sm"
                          onClick={() => openCopilotForApplication(item)}
                          title="Open the ATS page with this application linked to TalentOS Copilot"
                          style={{ background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.35)", color: "#10b981" }}
                        >
                          🧠 Copilot
                        </button>
                      )}
                      <div className="dropdown-wrapper">
                        <button className="btn-compact btn-outline btn-sm" onClick={() => faloodOpen === item.id ? setFaloodOpen(null) : openFaloodDropdown(item)} disabled={!item.candidates}>
                          🎨 Studio ▾
                        </button>
                        {faloodOpen === item.id && item.candidates && (
                          <div className="dropdown-menu">
                            <div className="dropdown-header">Base resumes for {item.candidates.name}</div>
                            {(faloodResumes[item.candidates.id] ?? []).length === 0 ? (
                              <button className="dropdown-item" onClick={() => buildBaseResume(item)} disabled={actionLoading === `${item.id}:build_base`}>
                                {actionLoading === `${item.id}:build_base` ? "Building..." : "+ Build base resume"}
                              </button>
                            ) : (
                              (faloodResumes[item.candidates.id] ?? []).map((br: any) => (
                                <button key={br.id} className="dropdown-item" onClick={() => { openFaloodStudio("base_resume", br.id); setFaloodOpen(null); }}>
                                  {br.name || "Untitled"}
                                </button>
                              ))
                            )}
                            <div className="dropdown-divider" />
                            <button className="dropdown-item muted" onClick={() => { setStatus(item.id, "in_progress"); setFaloodOpen(null); }} disabled={!item.assigned_to_user_id}>
                              {item.assigned_to_user_id ? "Mark in progress only" : "Assign owner first"}
                            </button>
                          </div>
                        )}
                      </div>

                      <button className="btn-compact btn-sm" onClick={() => requestReview(item)} disabled={actionLoading === `${item.id}:review` || item.workflow_status === "failed" || !item.base_resume_id || !item.workflow_resume_version_id} title={item.workflow_status === "failed" ? "Workflow failed" : (!item.base_resume_id || !item.workflow_resume_version_id ? "Missing artifacts" : "")}>
                        {actionLoading === `${item.id}:review` ? "⟳" : "🔍 Review"}
                      </button>

                      <button className="btn-compact btn-sm" onClick={() => uploadProof(item)} disabled={actionLoading === `${item.id}:proof` || item.workflow_status === "failed" || !item.base_resume_id || !item.workflow_resume_version_id}>
                        {actionLoading === `${item.id}:proof` ? "⟳" : "📎 Proof"}
                      </button>

                      {isManager && (
                        <>
                          <button className="btn-compact btn-sm" onClick={() => setEditing(item)}>✏️</button>
                          <button className="btn-danger btn-sm" onClick={() => removeTicket(item)}>🗑</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {renderPagination({ marginTop: 16, marginBottom: 0 })}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Edit{editing.candidates ? ` — ${editing.candidates.name}` : ""}</h2>
            <div className="modal-body" style={{ display: "grid", gap: 12 }}>
              <div className="field-group">
                <label>Owner</label>
                <select className="input" value={editing.assigned_to_user_id || ""} onChange={e => setEditing({ ...editing, assigned_to_user_id: e.target.value, assigned_to: users.find(u => u.user_id === e.target.value)?.display_name || "" })}>
                  <option value="">Unassigned</option>
                  {assignmentOwners.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label>Due date</label>
                <input className="input" type="date" value={editing.assignment_due_at || ""} onChange={e => setEditing({ ...editing, assignment_due_at: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Priority</label>
                <select className="input" value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value as any })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="field-group">
                <label>Review status</label>
                <select className="input" value={editing.review_status} onChange={e => setEditing({ ...editing, review_status: e.target.value as any })}>
                  <option value="not_required">No review</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="changes_requested">Changes requested</option>
                </select>
              </div>
              <div className="field-group">
                <label>Note</label>
                <textarea className="input" rows={3} value={editing.assignment_note || ""} onChange={e => setEditing({ ...editing, assignment_note: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={async () => {
                const res = await fetch(`/api/applications/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigned_to_user_id: editing.assigned_to_user_id || null, assigned_to: editing.assigned_to || null, assignment_due_at: editing.assignment_due_at || null, priority: editing.priority, review_status: editing.review_status, assignment_note: editing.assignment_note || null }) });
                if (res.ok) { setEditing(null); load(page, false); setFeedback({ kind: "success", text: "Saved." }); }
                else { setFeedback({ kind: "error", text: "Save failed." }); }
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function scoreLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}/10`;
}

function QueueScoreCell({ item }: { item: QueueItem }) {
  const average = item.average_score == null ? null : Number(item.average_score);
  const finalScore = item.workflow_score == null ? null : Number(item.workflow_score);
  if (average == null && finalScore == null) return <span className="text-muted" style={{ fontSize: 12 }}>Queued</span>;
  return (
    <div style={{ display: "grid", gap: 2, fontSize: 11 }}>
      <span className="badge badge-info" title="Average of ATS, recruiter, role fit, truth, and Final QA scores">Avg {scoreLabel(average)}</span>
      <span className="text-muted" title="Final Polish QA score">Final {scoreLabel(finalScore)}</span>
    </div>
  );
}

/** Findings are displayed inline in the queue, matching the pipeline board,
 * so reviewers do not lose their place by opening another page. */
function QueueFindingsPanel({ details }: { details: any }) {
  const artifacts: any[] = details?.artifacts ?? [];
  const hiringPanel = artifacts.find((a) => a.automation_id === "application_hiring_panel")?.data;
  const finalPolish = artifacts.find((a) => a.automation_id === "application_final_polish")?.data;
  return (
    <div style={{ marginTop: 6, padding: 8, background: "var(--surface-3)", borderRadius: 4, fontSize: 11, display: "grid", gap: 8 }}>
      {!details ? <div className="muted">Loading…</div> : !hiringPanel ? <div className="muted">Hiring Panel hasn't run yet.</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {[
              ["ATS", hiringPanel.atsScore],
              ["Recruiter", hiringPanel.recruiterScore],
              ["Role fit", hiringPanel.roleFitScore],
              ["Truth", typeof hiringPanel.truthfulnessRisk === "number" ? Math.max(0, 10 - hiringPanel.truthfulnessRisk) : null],
            ].map(([label, value]) => (
              <div key={String(label)} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "var(--ink-soft)" }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{scoreLabel(value as number | null) }</div>
              </div>
            ))}
          </div>
          {hiringPanel.overallComment && <div style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>&quot;{hiringPanel.overallComment}&quot;</div>}
          {hiringPanel.requiredEdits?.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Required edits</div>
              {hiringPanel.requiredEdits.map((e: any, i: number) => (
                <div key={i} style={{ display: "flex", gap: 4, alignItems: "baseline", padding: "2px 0" }}>
                  <span className={`badge badge-${e.severity === "critical" ? "danger" : e.severity === "major" ? "warning" : "info"}`} style={{ fontSize: 8 }}>{e.severity}</span>
                  <span>{e.description}</span>
                </div>
              ))}
            </div>
          )}
          {finalPolish && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>
                Final Polish
                <span className={`badge badge-${finalPolish.exportReady ? "success" : "warning"}`} style={{ marginLeft: 4, fontSize: 8 }}>
                  {finalPolish.exportReady ? "ready" : "not ready"}
                </span>
              </div>
              {finalPolish.unresolvedWarnings?.length > 0 && <div style={{ color: "var(--ink-soft)" }}>Unresolved: {finalPolish.unresolvedWarnings.join(", ")}</div>}
            </div>
          )}
          {(finalPolish?.pageFit || hiringPanel?.pageFit) && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>Page fit</div>
              <div>{formatPageFitSummary(finalPolish?.pageFit ?? hiringPanel?.pageFit)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FindingsButton({ item, onFetchDetails, expandedWorkflow }: { item: QueueItem; onFetchDetails: (item: QueueItem) => void; expandedWorkflow: string | null }) {
  if (!item.workflow_id || (item.workflow_stage ?? 0) < 2) return null;
  return (
    <button className="btn-compact btn-sm" onClick={() => onFetchDetails(item)} title="Show Hiring Panel and Final Polish findings inline">
      {expandedWorkflow === item.workflow_id ? "▲ Hide findings" : "📋 Findings"}
    </button>
  );
}

/** Renders the AI Pipeline cell with state-based actions. */
function PipelineActions({
  item, actionLoading, onStartWorkflow, onRegenerate, onFetchDetails, onReview,
  expandedWorkflow, workflowDetails, workflowStageLabel
}: {
  item: QueueItem;
  actionLoading: string | null;
  onStartWorkflow: (item: QueueItem) => void;
  onRegenerate: (item: QueueItem) => void;
  onFetchDetails: (item: QueueItem) => void;
  onReview: (wfId: string, action: string) => void;
  expandedWorkflow: string | null;
  workflowDetails: Record<string, any>;
  workflowStageLabel: (stage: number | null | undefined) => string;
}) {
  const genStatus = item.resume_generation_status;
  const wfStatus = item.workflow_status;
  const formattedWorkflowScore = formatScoreOutOfTen(item.workflow_score);

  // Ready — show the tailored resume link
  if (genStatus === "ready" && item.workflow_resume_version_id) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="badge badge-success">✅ Generated</span>
        {formattedWorkflowScore !== null && (
          <span style={{ fontSize: 12 }}>QA: <strong>{formattedWorkflowScore}/10</strong></span>
        )}
        {item.page_fit_metrics && (
          <span style={{ fontSize: 11 }} className={item.page_fit_metrics.overflow || !item.page_fit_metrics.readable ? "text-danger" : "text-muted"}>
            {formatPageFitSummary(item.page_fit_metrics)}
          </span>
        )}
        <button className="btn-primary btn-sm"
          onClick={() => openFaloodStudio("application_resume_version", item.workflow_resume_version_id!)}>
          ✏️ Open in Studio
        </button>
        <button className="btn-compact btn-sm"
          onClick={() => onRegenerate(item)}
          disabled={actionLoading === `${item.id}:regenerate`}
          title="Restart the full AI pipeline from scratch and replace this tailored resume">
          {actionLoading === `${item.id}:regenerate` ? "⟳ Regenerating..." : "🔁 Regenerate"}
        </button>
        <FindingsButton item={item} onFetchDetails={onFetchDetails} expandedWorkflow={expandedWorkflow} />
      </div>
    );
  }

  // Failed
  if (genStatus === "failed" || wfStatus === "failed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="badge badge-danger">❌ Failed</span>
        {item.workflow_id && (
          <button className="btn-compact btn-sm" onClick={() => onFetchDetails(item)}>
            View error
          </button>
        )}
        {/* startWorkflow sets actionLoading to `${item.id}:workflow`, not the
            bare item.id these two checks used to compare against - so the
            button never disabled and never showed "Retrying...". Confirmed
            live: three application_ai_workflows rows for the same
            application_id created 1 second apart (11:01:22/23/24), racing
            each other for the same stage claim and failing with "each claim
            orphaned without completing or erroring cleanly". */}
        <button className="btn-primary btn-sm"
          onClick={() => onStartWorkflow(item)}
          disabled={actionLoading === `${item.id}:workflow`}>
          {actionLoading === `${item.id}:workflow` ? "Retrying..." : "🔄 Retry"}
        </button>
        <FindingsButton item={item} onFetchDetails={onFetchDetails} expandedWorkflow={expandedWorkflow} />
      </div>
    );
  }

  // Human review needed — show Approve / Reject / Restart buttons
  if (genStatus === "human_review" || wfStatus === "waiting") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="badge badge-warning">Human Review</span>
        {formattedWorkflowScore !== null && (
          <span style={{ fontSize: 12 }}>QA: <strong>{formattedWorkflowScore}/10</strong></span>
        )}
        {item.page_fit_metrics && (
          <span style={{ fontSize: 11 }} className={item.page_fit_metrics.overflow || !item.page_fit_metrics.readable ? "text-danger" : "text-muted"}>
            {formatPageFitSummary(item.page_fit_metrics)}
          </span>
        )}
        {item.workflow_id && (
          <>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button className="btn-primary btn-sm"
                onClick={() => onReview(item.workflow_id!, "approve")}
                disabled={actionLoading === `${item.id}:approve`}>
                {actionLoading === `${item.id}:approve` ? "⟳" : "Approve"}
              </button>
              <button className="btn-compact btn-sm"
                onClick={() => { if (confirm("Reject this resume?")) onReview(item.workflow_id!, "reject"); }}
                disabled={actionLoading === `${item.id}:reject`}>
                {actionLoading === `${item.id}:reject` ? "⟳" : "Reject"}
              </button>
              <button className="btn-compact btn-sm"
                onClick={() => { if (confirm("Reject and restart from stage 1?")) onReview(item.workflow_id!, "reject_and_restart"); }}
                disabled={actionLoading === `${item.id}:restart`}>
                {actionLoading === `${item.id}:restart` ? "⟳" : "Restart"}
              </button>
            </div>
            <button className="btn-compact btn-sm" onClick={() => onFetchDetails(item)}>
              {expandedWorkflow === item.workflow_id ? "▲ Hide" : "▼ Details"}
            </button>
            <FindingsButton item={item} onFetchDetails={onFetchDetails} expandedWorkflow={expandedWorkflow} />
          </>
        )}
      </div>
    );
  }

  // Active (queued or running) — live pulse so a page left open visibly
  // shows progress instead of looking frozen while polling updates it.
  if (wfStatus === "queued" || wfStatus === "running") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, transition: "opacity 0.2s ease" }}>
        <span className={`badge badge-${wfStatus === "running" ? "info" : "warning"} pipeline-live-badge`}>
          <span className={`pipeline-live-dot ${wfStatus === "running" ? "pipeline-live-dot-running" : ""}`} />
          {wfStatus === "running" ? "Running" : "Queued"}
        </span>
        {item.workflow_stage !== null && item.workflow_stage !== undefined && (
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{workflowStageLabel(item.workflow_stage)}</span>
        )}
        {item.workflow_id && (
          <button className="btn-compact btn-sm" onClick={() => onFetchDetails(item)}>
            {expandedWorkflow === item.workflow_id ? "▲ Hide" : "▼ Details"}
          </button>
        )}
        <FindingsButton item={item} onFetchDetails={onFetchDetails} expandedWorkflow={expandedWorkflow} />
      </div>
    );
  }

  // Completed (no resume — shouldn't happen but handle gracefully)
  if (wfStatus === "completed") {
    return <span className="badge badge-success">✅ Completed</span>;
  }

  // Not started — show Generate button
  return (
    <button className="btn-primary btn-sm"
      onClick={() => onStartWorkflow(item)}
      disabled={actionLoading === `${item.id}:workflow`}>
      {actionLoading === `${item.id}:workflow` ? "⟳ Starting..." : "🤖 Generate"}
    </button>
  );
}
