"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

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
  next_action: string | null;
  proof_url: string | null;
  proof_filename: string | null;
  proof_uploaded_at: string | null;
  source_type: string | null;
  candidates: { id: string; name: string; email: string | null; phone: string | null; resume_url: string | null; resume_filename: string | null; candidate_number: number | null } | null;
  jobs: { id: string; title: string; company: string | null; location: string | null; source_url: string | null; job_category: string | null; category_relevance_score: number | null; job_number: number | null } | null;
  workflow_status?: string | null;
  workflow_id?: string | null;
  workflow_stage?: number | null;
  workflow_score?: number | null;
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
  overdue: number;
  pendingReview: number;
}

type TabView = "all" | "mine" | "overdue" | "review" | "workflow";

const STATUS_ICONS: Record<string, string> = {
  assigned: "📋",
  stacked: "📚",
  in_progress: "🔨",
  applied: "✅",
};

const WORKFLOW_LABELS: Record<number, string> = {
  0: "Queued",
  1: "🔍 Job Lens",
  2: "📝 Resume Forge",
  3: "👥 Hiring Panel",
  4: "✨ Final Polish",
};

function IdCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted" style={{ fontSize: 11 }}>—</span>;
  return (
    <span
      title={value}
      style={{ fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}
      onClick={() => navigator.clipboard?.writeText(value)}
    >
      {value.slice(0, 8)}…
    </span>
  );
}

export default function ApplicationQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [me, setMe] = useState<{ profile: { user_id: string; role: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<QueueStats>({ all: 0, mine: 0, overdue: 0, pendingReview: 0 });
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [viewFilter, setViewFilter] = useState<TabView>("all");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [editing, setEditing] = useState<QueueItem | null>(null);

  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, any>>({});
  const [faloodOpen, setFaloodOpen] = useState<string | null>(null);
  const [findingsWorkflowId, setFindingsWorkflowId] = useState<string | null>(null);
  const [faloodResumes, setFaloodResumes] = useState<Record<string, any[]>>({});

  function buildParams(pn: number) {
    const p = new URLSearchParams();
    p.set("page", String(pn));
    p.set("pageSize", String(pageSize));
    if (search) p.set("search", search);
    if (statusFilter) p.set("status", statusFilter);
    if (ownerFilter) p.set("owner", ownerFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    if (reviewFilter) p.set("review", reviewFilter);
    if (viewFilter !== "all") p.set("view", viewFilter);
    return p;
  }

  async function load(pn: number = page, clearFeedback = true) {
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
      const newTotal = data.total ?? 0;
      const tp = Math.max(1, Math.ceil(newTotal / pageSize));
      if (pn > tp && pn > 1) { setLoading(false); return load(tp); }
      setItems(data.items ?? []);
      setTotal(newTotal);
      setStats(data.stats ?? { all: 0, mine: 0, overdue: 0, pendingReview: 0 });
      if (usersRes.ok) setUsers(await usersRes.json());
      if (meRes.ok) setMe(await meRes.json());
      setSelected(new Set());
      setFaloodOpen(null);
      setExpandedWorkflow(null);
      setWorkflowDetails({});
      setFaloodResumes({});
      setPage(pn);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Load failed." });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(1); }, [search, statusFilter, ownerFilter, priorityFilter, reviewFilter, viewFilter, pageSize]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const pageRef = useRef(page);
  pageRef.current = page;

  // Auto-poll when visible items have active workflows (stale-closure safe)
  useEffect(() => {
    const hasActive = items.some(i =>
      i.workflow_status && ["queued", "running"].includes(i.workflow_status)
    );
    if (!hasActive) return;
    const id = setInterval(() => loadRef.current(pageRef.current, false), 5000);
    return () => clearInterval(id);
  }, [items]);

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const ownerLabel = (item: QueueItem) => {
    const u = item.assigned_to_user_id ? userMap.get(item.assigned_to_user_id) : null;
    return u?.display_name || u?.email || item.assigned_to || "Unassigned";
  };
  const owners = Array.from(new Map(items.filter(i => i.assigned_to_user_id || i.assigned_to).map(i => [i.assigned_to_user_id ?? i.assigned_to ?? "", ownerLabel(i)])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const assignmentOwners = [...users].sort((a, b) => ((a.role === "application_engineer" ? 0 : 1) - (b.role === "application_engineer" ? 0 : 1)) || (a.display_name || "").localeCompare(b.display_name || ""));
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
      const res = await fetch(`/api/applications/${id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s, completed_at: s === "applied" ? new Date().toISOString() : null, event_note: s === "applied" ? "Submitted from queue." : null }) });
      setActionLoading(null);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFeedback({ kind: "error", text: d.error || "Update failed." }); return; }
      setFeedback({ kind: "success", text: s === "applied" ? "Marked applied." : "Updated." });
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

  async function showFindings(item: QueueItem) {
    if (!item.workflow_id) return;
    if (!workflowDetails[item.workflow_id]) {
      try {
        const res = await fetch(`/api/application-ai-workflows/${item.workflow_id}?action=status`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setWorkflowDetails(p => ({ ...p, [item.workflow_id!]: data }));
        }
      } catch {}
    }
    setFindingsWorkflowId(item.workflow_id);
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
    await Promise.all(selectedItems.map(i => fetch(`/api/applications/${i.id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s, completed_at: s === "applied" ? new Date().toISOString() : null }) })));
    setFeedback({ kind: "success", text: "Bulk update done." });
    load(page, false);
  }

  async function bulkReassign() {
    if (!bulkOwnerId) return;
    const owner = users.find(u => u.user_id === bulkOwnerId);
    await Promise.all(selectedItems.map(i => fetch(`/api/applications/${i.id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigned_to_user_id: bulkOwnerId, assigned_to: owner?.display_name || owner?.email || null }) })));
    setBulkOwnerId("");
    setFeedback({ kind: "success", text: "Reassigned." });
    load(page, false);
  }

  async function removeTicket(item: QueueItem) {
    if (!confirm(`Remove ${item.candidates?.name ?? "this ticket"}?`)) return;
    const res = await fetch(`/api/applications/${item.id}`, { method: "DELETE" });
    if (res.ok) { setFeedback({ kind: "success", text: "Removed." }); load(page, false); }
    else { setFeedback({ kind: "error", text: "Remove failed." }); }
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
        window.open(`/falood/studio/base/${d.id}`, "_blank");
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const statTabs: { key: TabView; label: string; count: number }[] = [
    { key: "all", label: "All tickets", count: stats.all },
    { key: "mine", label: "Mine", count: stats.mine },
    { key: "overdue", label: "Overdue", count: stats.overdue },
    { key: "review", label: "Review", count: stats.pendingReview },
    { key: "workflow", label: "AI Pipeline", count: items.filter(i => i.workflow_status && ["queued", "running", "waiting"].includes(i.workflow_status)).length },
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
          <input className="input" placeholder="Search candidate, job, company..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="assigned">Assigned</option>
            <option value="stacked">Stacked</option>
            <option value="in_progress">In progress</option>
          </select>
          {owners.length > 0 && (
            <select className="input" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
              <option value="">All owners</option>
              {owners.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
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
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-panel" style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : total === 0 ? (
        <div className="empty-state" style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>No application tickets found.</div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                <th style={{ width: 28 }}><input type="checkbox" style={{ width: "auto" }} checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} /></th>
                <th>Candidate</th>
                <th>Job</th>
                <th>Status</th>
                <th>AI Pipeline</th>
                <th>Priority</th>
                <th>Review</th>
                <th>Owner</th>
                <th>Due</th>
                <th style={{ width: 120 }}>Ticket ID</th>
                <th style={{ width: 120 }}>Job ID</th>
                <th style={{ width: 120 }}>Base Resume ID</th>
                <th style={{ width: 120 }}>Tailored Resume ID</th>
                <th style={{ width: 280 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={expandedWorkflow === item.id ? "row-expanded" : ""}>
                  <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                  
                  <td className="cell-main">
                    {item.candidates ? (
                      <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <Link className="row-link" href={`/candidates/${item.candidates.id}`}>{item.candidates.name}</Link>
                          {item.candidates.candidate_number != null && (
                            <span className="badge badge-info" style={{ fontSize: 11, fontFamily: "monospace" }}>C#{item.candidates.candidate_number}</span>
                          )}
                          {item.app_number != null && (
                            <span className="badge" style={{ fontSize: 11, fontFamily: "monospace", background: "var(--surface-2)" }}>A#{item.app_number}</span>
                          )}
                        </div>
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
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <Link className="row-link" href={`/jobs/${item.jobs.id}`}>{item.jobs.title}</Link>
                          {item.jobs.job_number != null && (
                            <span className="badge badge-info" style={{ fontSize: 11, fontFamily: "monospace" }}>J#{item.jobs.job_number}</span>
                          )}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          {item.jobs.company || "—"} {item.jobs.location ? `• ${item.jobs.location}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                          {item.jobs.job_category && <span className="badge badge-info" style={{ fontSize: 11 }}>{item.jobs.job_category}</span>}
                          {item.jobs.source_url && <a href={item.jobs.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>Posting</a>}
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
                      onShowFindings={showFindings}
                    />
                    {expandedWorkflow === item.workflow_id && workflowDetails[item.workflow_id!] && (
                      <div className="workflow-detail" style={{ marginTop: 8, padding: 8, background: "var(--surface-2)", borderRadius: 6, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Pipeline Stages</div>
                        {workflowDetails[item.workflow_id!].stages?.map((s: any, i: number) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span>{s.automation_id?.replaceAll("_", " ") || `Stage ${s.sequence_number}`}</span>
                            <span className={`badge badge-${s.status === "success" ? "success" : s.status === "failed" ? "danger" : "warning"}`}>{s.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>

                  <td><span className={`badge badge-priority-${item.priority}`}>{item.priority}</span></td>

                  <td>
                    <span className={`badge badge-review-${item.review_status}`}>
                      {item.review_status === "pending" ? "⏳ Pending" : item.review_status === "approved" ? "✅ Approved" : item.review_status === "changes_requested" ? "✏️ Changes" : "—"}
                    </span>
                  </td>

                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{ownerLabel(item)}</div>
                    {item.assigned_by && <div className="text-muted" style={{ fontSize: 11 }}>by {item.assigned_by}</div>}
                  </td>

                  <td className={item.assignment_due_at ? dueClass(item.assignment_due_at) : "text-muted"} style={{ fontSize: 13 }}>
                    {item.assignment_due_at ? new Date(item.assignment_due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </td>

                  <td><IdCell value={item.id} /></td>
                  <td><IdCell value={item.jobs?.id ?? null} /></td>
                  <td><IdCell value={item.base_resume_id ?? null} /></td>
                  <td><IdCell value={item.workflow_resume_version_id ?? null} /></td>

                  <td>
                    <div className="action-group" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
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
                                <button key={br.id} className="dropdown-item" onClick={() => { window.open(`/falood/studio/base/${br.id}`, "_blank"); setFaloodOpen(null); }}>
                                  {br.name || "Untitled"}
                                </button>
                              ))
                            )}
                            <div className="dropdown-divider" />
                            <button className="dropdown-item muted" onClick={() => { setStatus(item.id, "in_progress"); setFaloodOpen(null); }}>Mark in progress only</button>
                          </div>
                        )}
                      </div>

                      <button className="btn-compact btn-sm" onClick={() => requestReview(item)} disabled={actionLoading === `${item.id}:review`}>
                        {actionLoading === `${item.id}:review` ? "⟳" : "🔍 Review"}
                      </button>

                      <button className="btn-compact btn-sm" onClick={() => uploadProof(item)} disabled={actionLoading === `${item.id}:proof`}>
                        {actionLoading === `${item.id}:proof` ? "⟳" : "📎 Proof"}
                      </button>

                      <button className="btn-primary btn-sm" onClick={() => setStatus(item.id, "applied")} disabled={actionLoading === `${item.id}:applied`}>
                        {actionLoading === `${item.id}:applied` ? "⟳" : "✅ Applied"}
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

      {total > 0 && (
        <div className="pagination" style={{ display: "flex", justifyContent: "center", gap: 4, padding: "16px 0" }}>
          <button className="btn-compact" disabled={page <= 1} onClick={() => load(page - 1)}>‹ Prev</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const pn = totalPages <= 7 ? i + 1 : Math.max(1, Math.min(page - 3 + i, totalPages - 6 + i));
            return (
              <button key={pn} className={`btn-compact ${pn === page ? "btn-primary" : ""}`} onClick={() => load(pn)}>{pn}</button>
            );
          })}
          <button className="btn-compact" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next ›</button>
          <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{total} total</span>
        </div>
      )}

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

      {findingsWorkflowId && (() => {
        const details = workflowDetails[findingsWorkflowId];
        const artifacts: any[] = details?.artifacts ?? [];
        const hiringPanel = artifacts.find((a) => a.automation_id === "application_hiring_panel")?.data;
        const finalPolish = artifacts.find((a) => a.automation_id === "application_final_polish")?.data;
        return (
          <div className="modal-overlay" onClick={() => setFindingsWorkflowId(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <h2>AI findings</h2>
              <div className="modal-body" style={{ display: "grid", gap: 16 }}>
                {!details ? (
                  <div className="text-muted">Loading…</div>
                ) : !hiringPanel ? (
                  <div className="text-muted">Hiring Panel hasn't run for this workflow yet.</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>ATS</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.atsScore}/10</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>Recruiter</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.recruiterScore}/10</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>Role fit</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.roleFitScore}/10</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>Truth risk</div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.truthfulnessRisk}/10</div>
                      </div>
                    </div>

                    {hiringPanel.overallComment && (
                      <div style={{ fontSize: 13, fontStyle: "italic", color: "var(--muted)" }}>
                        "{hiringPanel.overallComment}"
                      </div>
                    )}

                    {hiringPanel.requiredEdits?.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Required edits</div>
                        {hiringPanel.requiredEdits.map((e: any, i: number) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 13 }}>
                            <span className={`badge badge-${e.severity === "critical" ? "danger" : e.severity === "major" ? "warning" : "info"}`} style={{ fontSize: 10 }}>
                              {e.severity}
                            </span>
                            <span>{e.description}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {hiringPanel.optionalEdits?.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Optional edits</div>
                        {hiringPanel.optionalEdits.map((e: any, i: number) => (
                          <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{e.description}</div>
                        ))}
                      </div>
                    )}

                    {hiringPanel.formattingIssues?.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Formatting issues</div>
                        {hiringPanel.formattingIssues.map((f: string, i: number) => (
                          <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{f}</div>
                        ))}
                      </div>
                    )}

                    {finalPolish && (
                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                          What Final Polish fixed
                          <span className={`badge badge-${finalPolish.exportReady ? "success" : "warning"}`} style={{ marginLeft: 8, fontSize: 10 }}>
                            {finalPolish.exportReady ? "export ready" : "not export ready"}
                          </span>
                        </div>
                        {finalPolish.appliedIssueIds?.length > 0 && (
                          <div style={{ fontSize: 13, marginBottom: 4 }}>
                            Applied: {finalPolish.appliedIssueIds.join(", ")}
                          </div>
                        )}
                        {finalPolish.rejectedIssueIds?.length > 0 && (
                          <div style={{ fontSize: 13, marginBottom: 4 }}>
                            {finalPolish.rejectedIssueIds.map((r: any, i: number) => (
                              <div key={i}>Rejected {r.issueId}: {r.reason}</div>
                            ))}
                          </div>
                        )}
                        {finalPolish.unresolvedWarnings?.length > 0 && (
                          <div style={{ fontSize: 13, color: "var(--muted)" }}>
                            Unresolved: {finalPolish.unresolvedWarnings.join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn-outline" onClick={() => setFindingsWorkflowId(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Small link-styled button that opens the Hiring Panel findings modal. Only
 *  worth showing once Hiring Panel has actually run (stage index >= 3). */
function FindingsButton({ item, onShowFindings }: { item: QueueItem; onShowFindings: (item: QueueItem) => void }) {
  if (!item.workflow_id || (item.workflow_stage ?? 0) < 3) return null;
  return (
    <button className="btn-compact btn-sm" onClick={() => onShowFindings(item)}>
      📋 AI findings
    </button>
  );
}

/** Renders the AI Pipeline cell with state-based actions. */
function PipelineActions({
  item, actionLoading, onStartWorkflow, onFetchDetails, onReview,
  expandedWorkflow, workflowDetails, workflowStageLabel, onShowFindings
}: {
  item: QueueItem;
  actionLoading: string | null;
  onStartWorkflow: (item: QueueItem) => void;
  onFetchDetails: (item: QueueItem) => void;
  onReview: (wfId: string, action: string) => void;
  expandedWorkflow: string | null;
  workflowDetails: Record<string, any>;
  workflowStageLabel: (stage: number | null | undefined) => string;
  onShowFindings: (item: QueueItem) => void;
}) {
  const genStatus = item.resume_generation_status;
  const wfStatus = item.workflow_status;

  // Ready — show the tailored resume link
  if (genStatus === "ready" && item.workflow_resume_version_id) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="badge badge-success">✅ Generated</span>
        {item.workflow_score !== null && item.workflow_score !== undefined && (
          <span style={{ fontSize: 11 }}>Score: <strong>{item.workflow_score}/10</strong></span>
        )}
        <button className="btn-primary btn-sm"
          onClick={() => window.open(`/falood/studio/application/${item.workflow_resume_version_id}`, "_blank")}>
          ✏️ Open in Studio
        </button>
        <FindingsButton item={item} onShowFindings={onShowFindings} />
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
        <FindingsButton item={item} onShowFindings={onShowFindings} />
      </div>
    );
  }

  // Human review needed — show Approve / Reject / Restart buttons
  if (genStatus === "human_review" || wfStatus === "waiting") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="badge badge-warning">Human Review</span>
        {item.workflow_score !== null && item.workflow_score !== undefined && (
          <span style={{ fontSize: 11 }}>Score: <strong>{item.workflow_score}/10</strong></span>
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
            <FindingsButton item={item} onShowFindings={onShowFindings} />
          </>
        )}
      </div>
    );
  }

  // Active (queued or running)
  if (wfStatus === "queued" || wfStatus === "running") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className={`badge badge-${wfStatus === "running" ? "info" : "warning"}`}>
          {wfStatus === "running" ? "⚡ Running" : "⏳ Queued"}
        </span>
        {item.workflow_stage !== null && item.workflow_stage !== undefined && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{workflowStageLabel(item.workflow_stage)}</span>
        )}
        {item.workflow_id && (
          <button className="btn-compact btn-sm" onClick={() => onFetchDetails(item)}>
            {expandedWorkflow === item.workflow_id ? "▲ Hide" : "▼ Details"}
          </button>
        )}
        <FindingsButton item={item} onShowFindings={onShowFindings} />
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
