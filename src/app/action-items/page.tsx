"use client";

import { useEffect, useState } from "react";

interface ActionItem {
  id: string;
  candidate_id: string;
  candidate_name: string;
  type: string;
  title: string;
  description: string | null;
  suggested_action: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  created_at: string;
  application: { id: string; status: string; job_title: string; company: string } | null;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  normal: "var(--accent)",
  low: "var(--ink-soft)",
};

export default function ActionItemsPage() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");

  function load() {
    setLoading(true);
    fetch(`/api/action-items?status=${statusFilter}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/action-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Action Items</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Generated from candidate Gmail activity — replies needed, status changes to confirm, and follow-ups.
          </p>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)" }}>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)", border: "1px solid var(--border)", borderRadius: 12 }}>
          Nothing here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => (
            <div key={item.id} className="card" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 12, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLOR[item.priority] }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {item.candidate_name}
                  {item.application ? ` · ${item.application.job_title} at ${item.application.company}` : ""}
                </div>
                {item.description && <div style={{ fontSize: 13 }}>{item.description}</div>}
                {item.suggested_action && (
                  <div style={{ fontSize: 12, color: "var(--accent)" }}>Suggested: {item.suggested_action}</div>
                )}
              </div>
              {statusFilter === "open" || statusFilter === "in_progress" ? (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn" onClick={() => updateStatus(item.id, "done")}>Done</button>
                  <button className="btn" onClick={() => updateStatus(item.id, "dismissed")}>Dismiss</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
