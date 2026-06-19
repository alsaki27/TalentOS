"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import InterviewCard from "@/components/InterviewCard";
import Pagination from "@/components/Pagination";

interface InterviewItem {
  id: string;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  duration_minutes: number;
  status: string;
  location: string | null;
  meeting_link: string | null;
  applications: {
    candidate_id: string;
    job_id: string;
    candidates: { id: string; name: string; email: string | null } | null;
    jobs: { id: string; title: string; company: string | null } | null;
  } | null;
  panel: {
    id: string;
    interviewer_id: string;
    role: string;
    status: string;
    feedback_submitted: boolean;
    profile: { display_name: string | null; email: string | null } | null;
  }[];
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "scheduled": return "badge-scheduled";
    case "completed": return "badge-offer";
    case "cancelled": return "badge-closed";
    case "no_show": return "badge-rejected";
    case "in_progress": return "badge-in_progress";
    default: return "badge";
  }
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString();
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function InterviewsPage() {
  const [tab, setTab] = useState<"calendar" | "list">("calendar");
  const [items, setItems] = useState<InterviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [actionId, setActionId] = useState("");

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/interviews?${buildParams(pageNum, size)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load interviews.");
      const data = await res.json();
      const newTotal = data.total ?? 0;
      const totalPages = Math.max(1, Math.ceil(newTotal / size));
      if (pageNum > totalPages && pageNum > 1) {
        setLoading(false);
        return load(totalPages, size);
      }
      setItems(data.items ?? []);
      setTotal(newTotal);
      setPage(pageNum);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Could not load interviews." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1, pageSize); }, [search, statusFilter, dateFrom, dateTo, pageSize]);

  async function cancelInterview(id: string) {
    if (!confirm("Cancel this interview?")) return;
    setActionId(`${id}:cancel`);
    setFeedback(null);
    const res = await fetch(`/api/interviews/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not cancel interview." });
      return;
    }
    setFeedback({ kind: "success", text: "Interview cancelled." });
    load(page, pageSize);
  }

  async function sendReminder(id: string) {
    setActionId(`${id}:reminder`);
    setFeedback(null);
    // Placeholder — actual reminder logic depends on email integration
    await new Promise((r) => setTimeout(r, 500));
    setActionId("");
    setFeedback({ kind: "success", text: "Reminder sent (placeholder)." });
  }

  // Calendar: upcoming 7 days from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const interviewsByDay = new Map<number, InterviewItem[]>();
  for (const item of items) {
    if (!item.scheduled_at) continue;
    const d = new Date(item.scheduled_at);
    for (let i = 0; i < 7; i++) {
      if (isSameDay(d, weekDays[i])) {
        const list = interviewsByDay.get(i) ?? [];
        list.push(item);
        interviewsByDay.set(i, list);
        break;
      }
    }
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Interviews</h1>
          <div className="page-kicker">Schedule, manage, and review candidate interviews.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/interviews/scorecards">
            <button>Scorecards</button>
          </Link>
          <Link href="/interviews/schedule">
            <button className="btn-primary">Schedule Interview</button>
          </Link>
        </div>
      </div>

      {feedback && <div className={`toast ${feedback.kind === "error" ? "toast-error" : ""}`}>{feedback.text}</div>}

      <div className="workflow-panel">
        <div className="filter-bar">
          <input placeholder="Search candidate, round..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
          <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={tab === "calendar" ? "btn-primary" : ""} onClick={() => setTab("calendar")}>Calendar</button>
        <button className={tab === "list" ? "btn-primary" : ""} onClick={() => setTab("list")}>List</button>
      </div>

      {loading ? (
        <div className="loading-panel">Loading interviews...</div>
      ) : tab === "calendar" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginBottom: 12 }}>
            {weekDays.map((day, i) => (
              <div key={i} className="card" style={{ padding: 10, textAlign: "center", minHeight: 60 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{dayNames[day.getDay()]}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: isSameDay(day, today) ? "var(--accent)" : "var(--ink)" }}>
                  {day.getDate()}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {weekDays.map((day, i) => {
              const dayInterviews = interviewsByDay.get(i) ?? [];
              return (
                <div key={i} style={{ minHeight: 120 }}>
                  {dayInterviews.length === 0 && (
                    <div className="muted" style={{ fontSize: 11, textAlign: "center", paddingTop: 20 }}>No interviews</div>
                  )}
                  {dayInterviews.map((item) => (
                    <div key={item.id} style={{ marginBottom: 8 }}>
                      <InterviewCard interview={item} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          {total === 0 ? (
            <div className="empty">No interviews found.</div>
          ) : (
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Job</th>
                    <th>Round</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Panel</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="cell-main">
                        <Link className="row-link" href={`/interviews/${item.id}`}>
                          {item.applications?.candidates?.name ?? "—"}
                        </Link>
                        <div className="muted" style={{ fontSize: 12 }}>{item.applications?.candidates?.email}</div>
                      </td>
                      <td className="cell-main">
                        <Link className="row-link" href={`/jobs/${item.applications?.jobs?.id}`}>
                          {item.applications?.jobs?.title ?? "—"}
                        </Link>
                        <div className="muted" style={{ fontSize: 12 }}>{item.applications?.jobs?.company}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.round_name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>Round {item.round_number}</div>
                      </td>
                      <td>{formatDate(item.scheduled_at)}</td>
                      <td>{formatTime(item.scheduled_at)}</td>
                      <td><span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {item.panel.slice(0, 3).map((p) => (
                            <span key={p.id} className="avatar-circle" title={p.profile?.display_name || p.profile?.email || p.interviewer_id}>
                              {initials(p.profile?.display_name || p.profile?.email)}
                            </span>
                          ))}
                          {item.panel.length > 3 && (
                            <span className="avatar-circle" style={{ background: "var(--bg)", color: "var(--ink-soft)" }}>+{item.panel.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="action-group">
                          <Link href={`/interviews/${item.id}`}><button className="btn-compact">View</button></Link>
                          <button className="btn-compact" disabled={actionId === `${item.id}:cancel`} onClick={() => cancelInterview(item.id)}>
                            {actionId === `${item.id}:cancel` ? "Cancelling..." : "Cancel"}
                          </button>
                          <button className="btn-compact" disabled={actionId === `${item.id}:reminder`} onClick={() => sendReminder(item.id)}>
                            {actionId === `${item.id}:reminder` ? "Sending..." : "Reminder"}
                          </button>
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
        </div>
      )}
    </>
  );
}
