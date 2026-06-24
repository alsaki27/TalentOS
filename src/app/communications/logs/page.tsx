"use client";

import { useEffect, useState } from "react";
import Pagination from "@/components/Pagination";

interface EmailLog {
  id: string;
  candidate_id: string;
  subject: string;
  body: string;
  status: string;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  sent_at: string;
  sent_by: string | null;
  candidates: { id: string; name: string; email: string; avatar_url: string | null } | null;
  templates: { id: string; name: string; category: string } | null;
  step_number: number | null;
}

const STATUS_OPTIONS = ["All", "Sent", "Delivered", "Opened", "Clicked", "Bounced", "Replied", "Failed"];
const CHANNEL_OPTIONS = ["All", "Email", "In-app"];

const STATUS_COLORS: Record<string, string> = {
  sent: "badge-applied",
  delivered: "badge-interview",
  opened: "badge-offer",
  clicked: "badge-priority-high",
  bounced: "badge-rejected",
  failed: "badge-rejected",
  replied: "badge-interview",
};

export default function LogsPage() {
  const [items, setItems] = useState<EmailLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [channel, setChannel] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "timeline">("table");
  const [detailLog, setDetailLog] = useState<EmailLog | null>(null);

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    if (search) params.set("search", search);
    if (status !== "All") params.set("status", status.toLowerCase());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    const res = await fetch(`/api/email-logs?${buildParams(pageNum, size)}`, { cache: "no-store" });
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
    setLoading(false);
  }

  useEffect(() => { load(1, pageSize); }, [search, status, dateFrom, dateTo, pageSize]);

  async function resend(log: EmailLog) {
    if (!log.candidates?.id) return;
    const res = await fetch("/api/email/send", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: log.candidate_id,
        template_id: log.templates?.id ?? null,
        merge_data: { candidate_name: log.candidates?.name || "" },
      }),
    });
    if (res.ok) {
      alert("Email resent successfully.");
      load(page, pageSize);
    } else {
      const data = await res.json();
      alert(data.error || "Failed to resend.");
    }
  }

  async function trackOpen(id: string) {
    await fetch("/api/email-logs", {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, opened_at: new Date().toISOString(), status: "opened" }),
    });
    load(page, pageSize);
  }

  const filtersActive = search || status !== "All" || channel !== "All" || dateFrom || dateTo;

  function formatDate(d: string) {
    return new Date(d).toLocaleString();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Communication Log</h1>
          <p className="page-kicker">Track every email sent, opened, clicked, and replied.</p>
        </div>
        <div className="action-group">
          <button className={viewMode === "table" ? "btn-primary" : ""} onClick={() => setViewMode("table")}>Table</button>
          <button className={viewMode === "timeline" ? "btn-primary" : ""} onClick={() => setViewMode("timeline")}>Timeline</button>
        </div>
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <input placeholder="Search candidate or subject…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {filtersActive && (
          <button onClick={() => { setSearch(""); setStatus("All"); setChannel("All"); setDateFrom(""); setDateTo(""); }}>Clear filters</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
      </div>

      {loading ? (
        <div className="loading-panel">Loading logs…</div>
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No logs match these filters." : "No communication logs yet."}</div>
      ) : viewMode === "table" ? (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Subject</th>
                <th>Template</th>
                <th>Status</th>
                <th>Sent At</th>
                <th>Sent By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id} style={{ cursor: "pointer" }} onClick={() => setDetailLog(log)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{log.candidates?.name || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{log.candidates?.email || "—"}</div>
                  </td>
                  <td className="cell-main">{log.subject}</td>
                  <td>
                    {log.templates ? (
                      <span className="badge">{log.templates.name}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[log.status] || ""}`}>{log.status}</span>
                  </td>
                  <td className="muted">{formatDate(log.sent_at)}</td>
                  <td className="muted">{log.sent_by || "System"}</td>
                  <td>
                    <div className="action-group" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-compact" onClick={() => setDetailLog(log)}>View</button>
                      <button className="btn-compact" onClick={() => resend(log)}>Resend</button>
                      {!log.opened_at && (
                        <button className="btn-compact" onClick={() => trackOpen(log.id)}>Mark Open</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((log) => (
            <div key={log.id} className="card" onClick={() => setDetailLog(log)} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="badge">{log.status}</span>
                  <span style={{ fontWeight: 600 }}>{log.candidates?.name || "—"}</span>
                  <span className="muted">{log.subject}</span>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{formatDate(log.sent_at)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Template: {log.templates?.name || "—"} · Sent by: {log.sent_by || "System"}
                {log.opened_at && ` · Opened: ${formatDate(log.opened_at)}`}
                {log.clicked_at && ` · Clicked: ${formatDate(log.clicked_at)}`}
                {log.replied_at && ` · Replied: ${formatDate(log.replied_at)}`}
              </div>
            </div>
          ))}
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

      {detailLog && (
        <div className="modal-overlay" onClick={() => setDetailLog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: "95vw" }}>
            <h2>Email Details</h2>
            <div className="card" style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                <div><strong>Candidate:</strong> {detailLog.candidates?.name || "—"}</div>
                <div><strong>Status:</strong> <span className={`badge ${STATUS_COLORS[detailLog.status] || ""}`}>{detailLog.status}</span></div>
                <div><strong>Sent At:</strong> {formatDate(detailLog.sent_at)}</div>
                <div><strong>Sent By:</strong> {detailLog.sent_by || "System"}</div>
                {detailLog.opened_at && <div><strong>Opened:</strong> {formatDate(detailLog.opened_at)}</div>}
                {detailLog.clicked_at && <div><strong>Clicked:</strong> {formatDate(detailLog.clicked_at)}</div>}
                {detailLog.replied_at && <div><strong>Replied:</strong> {formatDate(detailLog.replied_at)}</div>}
              </div>
              <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Subject: {detailLog.subject}</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{detailLog.body}</div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setDetailLog(null)}>Close</button>
              <button className="btn-primary" onClick={() => resend(detailLog)}>Resend</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
