"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface QueueItem {
  id: string;
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
  candidates: { id: string; name: string; email: string | null; phone: string | null; resume_url: string | null; resume_filename: string | null } | null;
  jobs: { id: string; title: string; company: string | null; location: string | null; source_url: string | null; job_category: string | null; category_relevance_score: number | null } | null;
}

interface TeamUser {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
}

interface MeResponse {
  profile: {
    user_id: string;
    role: string;
  };
}

const PAGE_SIZE = 50;

export default function ApplicationQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [viewFilter, setViewFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<QueueItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [actionId, setActionId] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function load(pageNum = page) {
    setLoading(true);
    try {
      const [queueRes, usersRes] = await Promise.all([
        fetch(`/api/application-queue?page=${pageNum}&pageSize=${PAGE_SIZE}`),
        fetch("/api/users"),
      ]);
      if (!queueRes.ok) throw new Error("Could not load application queue.");
      setItems(await queueRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) setMe(await meRes.json());
      setSelected(new Set());
      setPage(pageNum);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Could not load application queue." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []);

  const userById = new Map(users.map((user) => [user.user_id, user]));
  const ownerName = (item: QueueItem) => {
    const user = item.assigned_to_user_id ? userById.get(item.assigned_to_user_id) : null;
    return user?.display_name || user?.email || item.assigned_to || "Unassigned";
  };
  const assignedByName = (item: QueueItem) => {
    const user = item.assigned_by_user_id ? userById.get(item.assigned_by_user_id) : null;
    return user?.display_name || user?.email || item.assigned_by || "";
  };
  const owners = Array.from(new Map(items
    .filter((item) => item.assigned_to_user_id || item.assigned_to)
    .map((item) => [item.assigned_to_user_id ?? item.assigned_to ?? "", ownerName(item)])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));
  const today = new Date().toISOString().slice(0, 10);
  const canManageAssignments = ["admin", "manager", "recruiter"].includes(me?.profile.role ?? "");
  const canApplyTicket = (item: QueueItem) => canManageAssignments || !["pending", "changes_requested"].includes(item.review_status);
  const assignmentOwners = [...users].sort((a, b) => {
    const aRank = a.role === "application_engineer" ? 0 : 1;
    const bRank = b.role === "application_engineer" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
  });

  const filtered = items.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (ownerFilter && (item.assigned_to_user_id ?? item.assigned_to ?? "") !== ownerFilter) return false;
    if (priorityFilter && item.priority !== priorityFilter) return false;
    if (reviewFilter && item.review_status !== reviewFilter) return false;
    if (viewFilter === "mine" && item.assigned_to_user_id !== me?.profile.user_id) return false;
    if (viewFilter === "overdue" && (!item.assignment_due_at || item.assignment_due_at > today)) return false;
    if (viewFilter === "review" && item.review_status !== "pending") return false;
    if (search) {
      const haystack = `${item.candidates?.name ?? ""} ${item.jobs?.title ?? ""} ${item.jobs?.company ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const selectedItems = filtered.filter((item) => selected.has(item.id));
  const counts = {
    overdue: items.filter((item) => item.assignment_due_at && item.assignment_due_at <= today).length,
    pendingReview: items.filter((item) => item.review_status === "pending").length,
    urgent: items.filter((item) => item.priority === "urgent").length,
    mine: items.filter((item) => item.assigned_to_user_id === me?.profile.user_id).length,
  };

  function dueClass(date: string | null) {
    if (!date) return "";
    if (date < today) return "overdue";
    if (date === today) return "today";
    return "";
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((item) => item.id)));
  }

  async function setStatus(id: string, status: string) {
    setActionId(`${id}:${status}`);
    setFeedback(null);
    const res = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        completed_at: status === "applied" ? new Date().toISOString() : null,
        event_note: status === "applied" ? "Application submitted from queue." : null,
      }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not update ticket." });
      return;
    }
    setFeedback({ kind: "success", text: status === "applied" ? "Application marked applied." : "Ticket updated." });
    load();
  }

  async function requestReview(item: QueueItem) {
    setActionId(`${item.id}:review`);
    setFeedback(null);
    const res = await fetch(`/api/applications/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        review_status: "pending",
        review_note: item.review_note ?? "Ready for manager review.",
        event_note: "Application ticket sent for manager review.",
      }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not request review." });
      return;
    }
    setFeedback({ kind: "success", text: "Sent for manager review." });
    load();
  }

  async function bulkStatus(status: string) {
    await Promise.all(selectedItems.map((item) => fetch(`/api/applications/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        completed_at: status === "applied" ? new Date().toISOString() : null,
        event_note: status === "applied" ? "Bulk marked applied from queue." : "Bulk status update from queue.",
      }),
    })));
    load();
  }

  async function bulkReassign() {
    if (!bulkOwnerId) return;
    const owner = users.find((user) => user.user_id === bulkOwnerId);
    await Promise.all(selectedItems.map((item) => fetch(`/api/applications/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_to_user_id: bulkOwnerId,
        assigned_to: owner?.display_name || owner?.email || null,
        event_note: "Bulk reassigned from queue.",
      }),
    })));
    setBulkOwnerId("");
    load();
  }

  async function removeTicket(item: QueueItem) {
    if (!confirm(`Remove this assignment${item.candidates ? ` for ${item.candidates.name}` : ""}?`)) return;
    await fetch(`/api/applications/${item.id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Application Queue</h1>
          <div className="page-kicker">Assigned application work, review gates, and due tickets.</div>
        </div>
        <button onClick={() => load(page)} disabled={loading}>Refresh</button>
      </div>

      {feedback && <div className={`toast ${feedback.kind === "error" ? "toast-error" : ""}`}>{feedback.text}</div>}

      <div className="stats-strip">
        <button className={`stat-button ${viewFilter === "all" ? "active" : ""}`} onClick={() => setViewFilter("all")}>
          <span className="stat-label">All tickets</span>
          <span className="stat-value">{items.length}</span>
        </button>
        <button className={`stat-button ${viewFilter === "mine" ? "active" : ""}`} onClick={() => setViewFilter("mine")}>
          <span className="stat-label">Mine</span>
          <span className="stat-value">{counts.mine}</span>
        </button>
        <button className={`stat-button ${viewFilter === "overdue" ? "active" : ""}`} onClick={() => setViewFilter("overdue")}>
          <span className="stat-label">Overdue / today</span>
          <span className="stat-value">{counts.overdue}</span>
        </button>
        <button className={`stat-button ${viewFilter === "review" ? "active" : ""}`} onClick={() => setViewFilter("review")}>
          <span className="stat-label">Review</span>
          <span className="stat-value">{counts.pendingReview}</span>
        </button>
      </div>

      <div className="workflow-panel">
      <div className="filter-bar">
        <input placeholder="Search candidate, job, company..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="assigned">Assigned</option>
          <option value="stacked">Stacked</option>
          <option value="in_progress">In progress</option>
        </select>
        {owners.length > 0 && (
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">All owners</option>
            {owners.map(([ownerValue, ownerLabel]) => <option key={ownerValue} value={ownerValue}>{ownerLabel}</option>)}
          </select>
        )}
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
          <option value="">All review states</option>
          <option value="not_required">No review</option>
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="changes_requested">Changes requested</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {items.length}</span>
      </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <div>
            <button className="btn-compact" onClick={() => bulkStatus("in_progress")}>Start selected</button>
            <button
              className="btn-primary btn-compact"
              onClick={() => bulkStatus("applied")}
              disabled={selectedItems.some((item) => !canApplyTicket(item))}
              title={selectedItems.some((item) => !canApplyTicket(item)) ? "One or more selected tickets need manager review first." : undefined}
            >
              Mark applied
            </button>
            {canManageAssignments && (
              <>
                <select value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} style={{ width: 220 }}>
                  <option value="">Reassign to...</option>
                  {assignmentOwners.map((user) => (
                    <option key={user.user_id} value={user.user_id}>{user.display_name || user.email}</option>
                  ))}
                </select>
                <button className="btn-compact" onClick={bulkReassign} disabled={!bulkOwnerId}>Reassign</button>
              </>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-panel">Loading application queue...</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No assigned application tickets.</div>
      ) : (
        <div className="table-shell">
        <table className="table table-compact">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th>Candidate</th>
              <th>Job</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Review</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Assignment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                <td className="cell-main">
                  {item.candidates ? (
                    <>
                      <Link className="row-link" href={`/candidates/${item.candidates.id}`}>{item.candidates.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{item.candidates.email || item.candidates.phone}</div>
                      {item.candidates.resume_url && (
                        <a href={item.candidates.resume_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Resume</a>
                      )}
                    </>
                  ) : "—"}
                </td>
                <td className="cell-main">
                  {item.jobs ? (
                    <>
                      <Link className="row-link" href={`/jobs/${item.jobs.id}`}>{item.jobs.title}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{item.jobs.company || "—"} {item.jobs.location ? `• ${item.jobs.location}` : ""}</div>
                      {item.jobs.job_category && <span className="badge">{item.jobs.job_category}</span>}
                      {item.jobs.source_url && <div><a href={item.jobs.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Posting</a></div>}
                    </>
                  ) : "—"}
                </td>
                <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                <td><span className={`badge badge-priority-${item.priority}`}>{item.priority}</span></td>
                <td><span className={`badge badge-review-${item.review_status}`}>{item.review_status.replaceAll("_", " ")}</span></td>
                <td>
                  <div>{ownerName(item)}</div>
                  {assignedByName(item) && <div className="muted" style={{ fontSize: 12 }}>from {assignedByName(item)}</div>}
                </td>
                <td className={item.assignment_due_at ? dueClass(item.assignment_due_at) : "muted"}>
                  {item.assignment_due_at ? new Date(item.assignment_due_at).toLocaleDateString() : "—"}
                </td>
                <td className="muted">{item.assignment_note || item.next_action || "—"}</td>
                <td>
                  <div className="action-group">
                  <button className="btn-compact" onClick={() => setStatus(item.id, "in_progress")} disabled={actionId === `${item.id}:in_progress`}>
                    {actionId === `${item.id}:in_progress` ? "Starting..." : "Start"}
                  </button>
                  <button className="btn-compact" onClick={() => requestReview(item)} disabled={actionId === `${item.id}:review`}>
                    {actionId === `${item.id}:review` ? "Sending..." : "Review"}
                  </button>
                  <button
                    className="btn-primary btn-compact"
                    onClick={() => setStatus(item.id, "applied")}
                    disabled={!canApplyTicket(item) || actionId === `${item.id}:applied`}
                    title={!canApplyTicket(item) ? "Manager review must be approved first." : undefined}
                  >
                    {actionId === `${item.id}:applied` ? "Saving..." : "Applied"}
                  </button>
                  {canManageAssignments && <button className="btn-compact" onClick={() => setEditing(item)}>Edit</button>}
                  {canManageAssignments && <button className="btn-danger btn-compact" onClick={() => removeTicket(item)}>Remove</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {editing && (
        <EditTicketModal
          item={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <div className="pagination-bar">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page === 1}>Previous</button>
        <span className="muted">Page {page}</span>
        <button onClick={() => load(page + 1)} disabled={loading || items.length < PAGE_SIZE}>Next</button>
      </div>
    </>
  );
}

function EditTicketModal({ item, users, onClose, onSaved }: { item: QueueItem; users: TeamUser[]; onClose: () => void; onSaved: () => void }) {
  const [assignedBy, setAssignedBy] = useState(item.assigned_by ?? "");
  const [assignedTo, setAssignedTo] = useState(item.assigned_to ?? "");
  const [assignedByUserId, setAssignedByUserId] = useState(item.assigned_by_user_id ?? "");
  const [assignedToUserId, setAssignedToUserId] = useState(item.assigned_to_user_id ?? "");
  const [assignmentDueAt, setAssignmentDueAt] = useState(item.assignment_due_at ?? "");
  const [assignmentNote, setAssignmentNote] = useState(item.assignment_note ?? "");
  const [priority, setPriority] = useState(item.priority ?? "normal");
  const [reviewStatus, setReviewStatus] = useState(item.review_status ?? "not_required");
  const [reviewNote, setReviewNote] = useState(item.review_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assignmentOwners = [...users].sort((a, b) => {
    const aRank = a.role === "application_engineer" ? 0 : 1;
    const bRank = b.role === "application_engineer" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
  });

  async function submit() {
    setSaving(true);
    setError("");
    const assignedByUser = users.find((user) => user.user_id === assignedByUserId);
    const assignedToUser = users.find((user) => user.user_id === assignedToUserId);
    const res = await fetch(`/api/applications/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_by: assignedByUser?.display_name || assignedByUser?.email || assignedBy || null,
        assigned_to: assignedToUser?.display_name || assignedToUser?.email || assignedTo || null,
        assigned_by_user_id: assignedByUserId || null,
        assigned_to_user_id: assignedToUserId || null,
        assignment_due_at: assignmentDueAt || null,
        assignment_note: assignmentNote || null,
        priority,
        review_status: reviewStatus,
        review_note: reviewNote || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit assignment{item.candidates ? ` — ${item.candidates.name}` : ""}</h2>

        <div className="field-group">
          <label>Assigned by</label>
          <select value={assignedByUserId} onChange={(e) => setAssignedByUserId(e.target.value)}>
            <option value="">Legacy / unassigned</option>
            {assignmentOwners.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.display_name || user.email} ({user.role.replaceAll("_", " ")})
              </option>
            ))}
          </select>
          {!assignedByUserId && (
            <input style={{ marginTop: 8 }} value={assignedBy} onChange={(e) => setAssignedBy(e.target.value)} placeholder="Legacy manager/admin name" />
          )}
        </div>
        <div className="field-group">
          <label>Application owner</label>
          <select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)}>
            <option value="">Unassigned</option>
            {assignmentOwners.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.display_name || user.email} ({user.role.replaceAll("_", " ")})
              </option>
            ))}
          </select>
          {!assignedToUserId && (
            <input style={{ marginTop: 8 }} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Legacy application owner name" />
          )}
        </div>
        <div className="field-group">
          <label>Due date</label>
          <input type="date" value={assignmentDueAt} onChange={(e) => setAssignmentDueAt(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as QueueItem["priority"])}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="field-group">
          <label>Review status</label>
          <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as QueueItem["review_status"])}>
            <option value="not_required">No review required</option>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes requested</option>
          </select>
        </div>
        <div className="field-group">
          <label>Review note</label>
          <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} />
        </div>
        <div className="field-group">
          <label>Assignment note</label>
          <textarea value={assignmentNote} onChange={(e) => setAssignmentNote(e.target.value)} rows={3} />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
