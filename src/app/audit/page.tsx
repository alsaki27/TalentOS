// src/app/audit/page.tsx
// Admin-only viewer for audit_logs — every user.created/application.created/etc.
// event written across the app, finally readable somewhere.
"use client";

import { useEffect, useState } from "react";
import { TableSkeleton } from "../Skeleton";

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");

  async function load(pageNum: number) {
    setLoading(true);
    setForbidden(false);
    const params = new URLSearchParams({ page: String(pageNum) });
    if (actionFilter) params.set("action", actionFilter);
    if (entityTypeFilter) params.set("entityType", entityTypeFilter);
    const res = await fetch(`/api/audit-logs?${params}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json();
    setLogs(data.logs ?? []);
    setTotal(data.total ?? 0);
    setPage(pageNum);
    setLoading(false);
  }

  useEffect(() => { load(1); }, [actionFilter, entityTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actions = Array.from(new Set(logs.map((l) => l.action))).sort();
  const entityTypes = Array.from(new Set(logs.map((l) => l.entity_type))).sort();

  if (forbidden) {
    return <div className="empty">Admins only.</div>;
  }

  return (
    <>
      <div className="page-header">
        <h1>Audit log</h1>
      </div>

      <div className="filter-bar">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityTypeFilter} onChange={(e) => setEntityTypeFilter(e.target.value)}>
          <option value="">All entity types</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{logs.length} of {total}</span>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : logs.length === 0 ? (
        <div className="empty">No activity recorded yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="muted" style={{ fontSize: 12 }}>{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.actor_email || "—"}</td>
                <td><span className="badge">{log.action}</span></td>
                <td className="muted">{log.entity_type}{log.entity_id ? ` #${log.entity_id.slice(0, 8)}` : ""}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {Object.keys(log.metadata ?? {}).length > 0 ? JSON.stringify(log.metadata) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <div className="filter-bar" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => load(page - 1)} disabled={loading || page <= 1}>Prev</button>
          <span className="muted" style={{ fontSize: 12 }}>Page {page} of {totalPages}</span>
          <button onClick={() => load(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        </div>
      )}
    </>
  );
}
