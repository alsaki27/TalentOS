"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface QueueItem {
  id: string;
  status: string;
  assigned_by: string | null;
  assigned_to: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  next_action: string | null;
  candidates: { id: string; name: string; email: string | null; phone: string | null; resume_url: string | null; resume_filename: string | null } | null;
  jobs: { id: string; title: string; company: string | null; location: string | null; source_url: string | null; job_category: string | null; category_relevance_score: number | null } | null;
}

export default function ApplicationQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/application-queue");
    setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const owners = Array.from(new Set(items.map((item) => item.assigned_to).filter(Boolean))).sort() as string[];
  const today = new Date().toISOString().slice(0, 10);

  const filtered = items.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (ownerFilter && item.assigned_to !== ownerFilter) return false;
    if (search) {
      const haystack = `${item.candidates?.name ?? ""} ${item.jobs?.title ?? ""} ${item.jobs?.company ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  async function setStatus(id: string, status: string) {
    await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        completed_at: status === "applied" ? new Date().toISOString() : null,
        event_note: status === "applied" ? "Application submitted from queue." : null,
      }),
    });
    load();
  }

  return (
    <>
      <div className="page-header">
        <h1>Application Queue</h1>
      </div>

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
            {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
          </select>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {items.length}</span>
      </div>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="empty">No assigned application tickets.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Job</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Assignment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>
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
                <td>
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
                <td>
                  <div>{item.assigned_to || "Unassigned"}</div>
                  {item.assigned_by && <div className="muted" style={{ fontSize: 12 }}>from {item.assigned_by}</div>}
                </td>
                <td className={item.assignment_due_at && item.assignment_due_at <= today ? "muted" : "muted"}>
                  {item.assignment_due_at ? new Date(item.assignment_due_at).toLocaleDateString() : "—"}
                </td>
                <td className="muted">{item.assignment_note || item.next_action || "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setStatus(item.id, "in_progress")}>Start</button>
                  <button className="btn-primary" onClick={() => setStatus(item.id, "applied")}>Mark applied</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
