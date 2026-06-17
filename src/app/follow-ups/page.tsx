// src/app/follow-ups/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface FollowUp {
  id: string;
  status: string;
  follow_up_at: string;
  next_action: string | null;
  candidates: { id: string; name: string } | null;
  jobs: { id: string; title: string; company: string | null } | null;
}

export default function FollowUpsPage() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dueFilter, setDueFilter] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/follow-ups");
    setItems(await res.json());
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markDone(id: string) {
    await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_at: null }),
    });
    load();
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this application entirely (not just the follow-up)?")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected application(s) entirely?`)) return;
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/applications/${id}`, { method: "DELETE" })));
    load();
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  const filtered = items.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (dueFilter === "overdue" && item.follow_up_at > today) return false;
    if (dueFilter === "upcoming" && item.follow_up_at <= today) return false;
    if (search) {
      const haystack = `${item.candidates?.name ?? ""} ${item.jobs?.title ?? ""} ${item.jobs?.company ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id))));
  }

  const filtersActive = search || statusFilter || dueFilter;

  return (
    <>
      <div className="page-header">
        <h1>Follow-ups</h1>
      </div>

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
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {items.length}</span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">No follow-ups scheduled. Set a follow-up date from a candidate's profile.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No follow-ups match these filters.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th>Due</th>
              <th>Candidate</th>
              <th>Job</th>
              <th>Status</th>
              <th>Next action</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                <td style={item.follow_up_at <= today ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                  {new Date(item.follow_up_at).toLocaleDateString()}
                </td>
                <td>
                  {item.candidates ? (
                    <Link className="row-link" href={`/candidates/${item.candidates.id}`}>{item.candidates.name}</Link>
                  ) : "—"}
                </td>
                <td className="muted">{item.jobs?.title} {item.jobs?.company ? `— ${item.jobs.company}` : ""}</td>
                <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                <td className="muted">{item.next_action || "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => markDone(item.id)}>Mark done</button>
                  <button onClick={() => deleteOne(item.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
