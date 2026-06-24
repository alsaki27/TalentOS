// src/app/follow-ups/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Pagination from "@/components/Pagination";

interface FollowUp {
  id: string;
  status: string;
  follow_up_at: string;
  follow_up_source: string | null;
  follow_up_created_at: string | null;
  assigned_to: string | null;
  assigned_to_user_id: string | null;
  next_action: string | null;
  candidates: { id: string; name: string } | null;
  jobs: { id: string; title: string; company: string | null } | null;
}

interface FollowUpStats {
  all: number;
  due: number;
  upcoming: number;
  auto: number;
  manual: number;
}

export default function FollowUpsPage() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<FollowUpStats>({ all: 0, due: 0, upcoming: 0, auto: 0, manual: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dueFilter, setDueFilter] = useState("");
  const [actionId, setActionId] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (dueFilter) params.set("dueFilter", dueFilter);
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/follow-ups?${buildParams(pageNum, size)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load follow-ups.");
      const data = await res.json();
      const newTotal = data.total ?? 0;
      const totalPages = Math.max(1, Math.ceil(newTotal / size));
      if (pageNum > totalPages && pageNum > 1) {
        setLoading(false);
        return load(totalPages, size);
      }
      setItems(data.items ?? []);
      setTotal(newTotal);
      setStats(data.stats ?? { all: 0, due: 0, upcoming: 0, auto: 0, manual: 0 });
      setSelected(new Set());
      setPage(pageNum);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Could not load follow-ups." });
    } finally {
      setLoading(false);
    }
  }

  // Any filter/search change re-queries from page 1.
  useEffect(() => { load(1, pageSize); }, [search, statusFilter, dueFilter, pageSize]);

  async function markDone(id: string) {
    setActionId(`${id}:done`);
    setFeedback(null);
    const res = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_at: null, event_note: "Follow-up reminder completed." }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not complete reminder." });
      return;
    }
    setFeedback({ kind: "success", text: "Reminder completed." });
    load(page, pageSize);
  }

  async function snooze(id: string, days: number) {
    setActionId(`${id}:snooze:${days}`);
    setFeedback(null);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const res = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        follow_up_at: due.toISOString().slice(0, 10),
        follow_up_source: "manual",
        event_note: `Follow-up snoozed ${days} day(s).`,
      }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not snooze reminder." });
      return;
    }
    setFeedback({ kind: "success", text: `Snoozed ${days} day(s).` });
    load(page, pageSize);
  }

  async function setStatus(id: string, status: string) {
    setActionId(`${id}:status:${status}`);
    setFeedback(null);
    const res = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, event_note: `Status updated from follow-up queue to ${status}.` }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not update status." });
      return;
    }
    setFeedback({ kind: "success", text: "Status updated." });
    load(page, pageSize);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this application entirely (not just the follow-up)?")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE", cache: "no-store" });
    load(page, pageSize);
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected application(s) entirely?`)) return;
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/applications/${id}`, { method: "DELETE", cache: "no-store" })));
    load(page, pageSize);
  }

  async function markSelectedDone() {
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/applications/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_at: null, event_note: "Bulk follow-up reminders completed." }),
    })));
    load(page, pageSize);
  }

  async function snoozeSelected(days: number) {
    const due = new Date();
    due.setDate(due.getDate() + days);
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/applications/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        follow_up_at: due.toISOString().slice(0, 10),
        follow_up_source: "manual",
        event_note: `Bulk follow-up reminders snoozed ${days} day(s).`,
      }),
    })));
    load(page, pageSize);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  function dueClass(date: string) {
    if (date < today) return "overdue";
    if (date === today) return "today";
    return "";
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  const filtersActive = search || statusFilter || dueFilter;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Follow-ups</h1>
          <div className="page-kicker">Auto reminders, manual snoozes, and next actions from application activity.</div>
        </div>
        <button onClick={() => load(page, pageSize)} disabled={loading}>Refresh</button>
      </div>

      {feedback && <div className={`toast ${feedback.kind === "error" ? "toast-error" : ""}`}>{feedback.text}</div>}

      <div className="stats-strip">
        <button className={`stat-button ${dueFilter === "" ? "active" : ""}`} onClick={() => setDueFilter("")}>
          <span className="stat-label">All reminders</span>
          <span className="stat-value">{stats.all}</span>
        </button>
        <button className={`stat-button ${dueFilter === "overdue" ? "active" : ""}`} onClick={() => setDueFilter("overdue")}>
          <span className="stat-label">Due now</span>
          <span className="stat-value">{stats.due}</span>
        </button>
        <button className={`stat-button ${dueFilter === "upcoming" ? "active" : ""}`} onClick={() => setDueFilter("upcoming")}>
          <span className="stat-label">Upcoming</span>
          <span className="stat-value">{stats.upcoming}</span>
        </button>
        <div className="stat-card">
          <span className="stat-label">Auto / manual</span>
          <span className="stat-value">{stats.auto} / {stats.manual}</span>
        </div>
      </div>

      <div className="workflow-panel">
      <div className="filter-bar">
        <input placeholder="Search candidate, job, company…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="applied">Applied</option>
          <option value="replied">Replied</option>
          <option value="interview">Interview</option>
          <option value="rejected">Rejected</option>
          <option value="offer">Offer</option>
        </select>
        <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)}>
          <option value="">All due dates</option>
          <option value="overdue">Overdue/today</option>
          <option value="upcoming">Upcoming</option>
        </select>
        {filtersActive && (
          <button onClick={() => { setSearch(""); setStatusFilter(""); setDueFilter(""); }}>Clear filters</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
      </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <div>
            <button className="btn-compact" onClick={() => snoozeSelected(2)}>Snooze 2d</button>
            <button className="btn-compact" onClick={() => snoozeSelected(7)}>Snooze 7d</button>
            <button className="btn-compact" onClick={markSelectedDone}>Mark done</button>
            <button className="btn-danger btn-compact" onClick={deleteSelected}>Delete selected</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-panel">Loading follow-ups...</div>
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No follow-ups match these filters." : "No follow-ups scheduled. Set a follow-up date from a candidate's profile."}</div>
      ) : (
        <div className="table-shell">
        <table className="table table-compact">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.size === items.length} onChange={toggleAll} />
              </th>
              <th>Due</th>
              <th>Candidate</th>
              <th>Job</th>
              <th>Status</th>
              <th>Source</th>
              <th>Next action</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                <td>
                  <span className={`date-pill ${dueClass(item.follow_up_at)}`}>
                    {new Date(item.follow_up_at).toLocaleDateString()}
                  </span>
                </td>
                <td>
                  {item.candidates ? (
                    <Link className="row-link" href={`/candidates/${item.candidates.id}`}>{item.candidates.name}</Link>
                  ) : "—"}
                </td>
                <td className="muted">{item.jobs?.title} {item.jobs?.company ? `— ${item.jobs.company}` : ""}</td>
                <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                <td>
                  <span className="badge">{item.follow_up_source === "auto_status_rule" ? "Auto" : "Manual"}</span>
                </td>
                <td className="cell-note">{item.next_action || "—"}</td>
                <td>
                  <div className="action-group">
                  <button className="btn-compact" onClick={() => snooze(item.id, 2)} disabled={actionId === `${item.id}:snooze:2`}>
                    {actionId === `${item.id}:snooze:2` ? "Saving..." : "+2d"}
                  </button>
                  <button className="btn-compact" onClick={() => snooze(item.id, 7)} disabled={actionId === `${item.id}:snooze:7`}>
                    {actionId === `${item.id}:snooze:7` ? "Saving..." : "+7d"}
                  </button>
                  {item.status === "applied" && (
                    <button className="btn-compact" onClick={() => setStatus(item.id, "replied")} disabled={actionId === `${item.id}:status:replied`}>
                      Replied
                    </button>
                  )}
                  {item.status === "replied" && (
                    <button className="btn-compact" onClick={() => setStatus(item.id, "interview")} disabled={actionId === `${item.id}:status:interview`}>
                      Interview
                    </button>
                  )}
                  <button className="btn-compact" onClick={() => markDone(item.id)} disabled={actionId === `${item.id}:done`}>
                    {actionId === `${item.id}:done` ? "Saving..." : "Done"}
                  </button>
                  <button className="btn-danger btn-compact" onClick={() => deleteOne(item.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(newPage) => load(newPage, pageSize)}
          onPageSizeChange={(newSize) => setPageSize(newSize)}
        />
      )}
    </>
  );
}
