"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ApprovalCard, { type ApprovalItem } from "../components/ApprovalCard";

type ViewFilter = "pending" | "approved" | "rejected" | "all";

interface CountsResponse {
  approvals: { pending: number; urgent: number; approvedToday: number; rejectedToday: number };
}

export default function ApprovalsPage() {
  const [view, setView] = useState<ViewFilter>("pending");
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<CountsResponse["approvals"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Every id currently mid-decision, whether from a single card's Approve/
  // Reject or a bulk action - the periodic background refresh below skips
  // its merge entirely while this is non-empty, so a poll can never
  // resurrect a row the AE is in the middle of deciding.
  const busyIdsRef = useRef<Set<string>>(new Set());

  const fetchApprovals = useCallback(async (): Promise<{ items: ApprovalItem[]; total: number } | null> => {
    const res = await fetch(`/api/inbox/approvals?view=${view}&pageSize=50`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load approvals.");
    return { items: data.items ?? [], total: Number(data.total ?? 0) };
  }, [view]);

  const fetchCounts = useCallback(async () => {
    const res = await fetch("/api/inbox/counts", { cache: "no-store" });
    if (res.ok) setCounts((await res.json()).approvals);
  }, []);

  // Tab switch / initial mount: always a full, wholesale load - there's no
  // "resurrected row" risk here since the view itself just changed.
  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [approvals] = await Promise.all([fetchApprovals(), fetchCounts()]);
      if (approvals) { setItems(approvals.items); setTotal(approvals.total); }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, [fetchApprovals, fetchCounts]);

  // Periodic background refresh: merge by id, never replace wholesale
  // (that would reset scroll and any note an AE is mid-typing), and skip
  // entirely while a decision is in flight.
  const refreshInPlace = useCallback(async () => {
    if (busyIdsRef.current.size > 0) return;
    try {
      const approvals = await fetchApprovals();
      if (!approvals) return;
      setItems((prev) => {
        const byId = new Map(approvals.items.map((i) => [i.id, i]));
        const stillPresent = prev.filter((p) => byId.has(p.id)).map((p) => ({ ...p, ...byId.get(p.id)! }));
        const presentIds = new Set(prev.map((p) => p.id));
        const newOnes = approvals.items.filter((i) => !presentIds.has(i.id));
        return [...newOnes, ...stillPresent];
      });
      setTotal(approvals.total);
      fetchCounts();
    } catch {
      // A background refresh failing silently is fine - the next tick retries.
    }
  }, [fetchApprovals, fetchCounts]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refreshInPlace();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshInPlace]);

  function onDecideStart(id: string) {
    busyIdsRef.current.add(id);
  }
  function onDecideEnd(id: string) {
    busyIdsRef.current.delete(id);
  }

  function onDecided(id: string, outcome: { decision: "approved" | "rejected"; ok: boolean; error?: string }) {
    if (!outcome.ok) {
      setMessage(outcome.error || "Could not record that decision.");
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setTotal((prev) => Math.max(0, prev - 1));
    fetchCounts();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  async function bulkDecide(decision: "approved" | "rejected") {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkBusy(true);
    setMessage("");
    for (const id of ids) busyIdsRef.current.add(id);
    try {
      const res = await fetch("/api/inbox/approvals/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bulk decision failed.");
      const results: { id: string; ok: boolean; error?: string }[] = data.results ?? [];
      const failed = results.filter((r) => !r.ok);
      setMessage(failed.length ? `${results.length - failed.length} succeeded, ${failed.length} failed.` : `${results.length} ${decision}.`);
      const succeededIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
      setItems((prev) => prev.filter((item) => !succeededIds.has(item.id)));
      setTotal((prev) => Math.max(0, prev - succeededIds.size));
      setSelected(new Set());
      fetchCounts();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bulk decision failed.");
    } finally {
      for (const id of ids) busyIdsRef.current.delete(id);
      setBulkBusy(false);
    }
  }

  const tabs: { key: ViewFilter; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts?.pending ?? 0 },
    { key: "approved", label: "Approved today", count: counts?.approvedToday ?? 0 },
    { key: "rejected", label: "Rejected today", count: counts?.rejectedToday ?? 0 },
    { key: "all", label: "All", count: total },
  ];

  return (
    <div className="page" style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 48px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
        <h1 style={{ margin: "6px 0 4px" }}>Pending Approvals</h1>
        <p className="page-kicker" style={{ margin: 0 }}>AI-detected status changes from candidate email, waiting on an AE decision.</p>
      </div>

      <div className="stats-strip" style={{ gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", marginBottom: 16 }}>
        {tabs.map((tab) => (
          <button key={tab.key} className={`stat-button ${view === tab.key ? "active" : ""}`} onClick={() => setView(tab.key)}>
            <span className="stat-label">{tab.label}</span>
            <span className="stat-value">{tab.count}</span>
          </button>
        ))}
      </div>

      {view === "pending" && items.length > 0 && (
        <div className="bulk-bar" style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} style={{ width: "auto" }} />
            <span className="bulk-count">{selected.size > 0 ? `${selected.size} selected` : "Select all"}</span>
          </label>
          {selected.size > 0 && (
            <div className="bulk-actions">
              <button className="btn-primary btn-compact" disabled={bulkBusy} onClick={() => bulkDecide("approved")}>Approve selected</button>
              <button className="btn-compact" disabled={bulkBusy} onClick={() => bulkDecide("rejected")}>Reject selected</button>
            </div>
          )}
        </div>
      )}

      {message && <div className="notice" style={{ marginBottom: 14 }}>{message}<button className="alert-close" onClick={() => setMessage("")}>×</button></div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }} className="text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty" style={{ padding: 40, textAlign: "center" }}>No {view === "pending" ? "pending" : view} approvals.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggleSelect={view === "pending" ? toggleSelect : undefined}
              onDecided={onDecided}
              onDecideStart={onDecideStart}
              onDecideEnd={onDecideEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
