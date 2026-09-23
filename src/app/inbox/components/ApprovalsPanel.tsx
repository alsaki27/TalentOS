"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ApprovalCard, { type ApprovalItem } from "./ApprovalCard";

type ViewFilter = "pending" | "approved" | "rejected" | "all";

interface CountsResponse {
  approvals: { pending: number; urgent: number; approvedToday: number; rejectedToday: number };
}

export default function ApprovalsPanel({ candidateId }: { candidateId?: string }) {
  const [view, setView] = useState<ViewFilter>("pending");
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [counts, setCounts] = useState<CountsResponse["approvals"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const busyIdsRef = useRef<Set<string>>(new Set());

  const fetchApprovals = useCallback(async (p = page): Promise<{ items: ApprovalItem[]; total: number; totalPages: number } | null> => {
    let url = `/api/inbox/approvals?view=${view}&pageSize=50&page=${p}`;
    if (candidateId) url += `&candidateId=${candidateId}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load approvals.");
    return { items: data.items ?? [], total: Number(data.total ?? 0), totalPages: Number(data.totalPages ?? 1) };
  }, [view, candidateId, page]);

  const fetchCounts = useCallback(async () => {
    let url = "/api/inbox/counts";
    if (candidateId) url += `?candidateId=${candidateId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) setCounts((await res.json()).approvals);
  }, [candidateId]);

  const loadInitial = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const [approvals] = await Promise.all([fetchApprovals(p), fetchCounts()]);
      if (approvals) { 
        setItems(approvals.items); 
        setTotal(approvals.total); 
        setTotalPages(approvals.totalPages);
        setPage(p);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, [fetchApprovals, fetchCounts, page]);

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
    }
  }, [fetchApprovals, fetchCounts]);

  useEffect(() => { loadInitial(1); }, [view, candidateId]);
  useEffect(() => { loadInitial(page); }, [page]);

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
    <div style={{ padding: "0" }}>
      <div className="stats-strip" style={{ gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", marginBottom: 16 }}>
        {tabs.map((tab) => (
          <button key={tab.key} className={`stat-button ${view === tab.key ? "active" : ""}`} onClick={() => { setView(tab.key); setPage(1); }}>
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
          {renderPagination({ marginTop: 12, marginBottom: 12 })}
        </div>
      )}
    </div>
  );

  function goToPage(val: string) {
    const p = parseInt(val.trim(), 10);
    if (isNaN(p) || p < 1 || p > totalPages) {
      setPageError(`Enter a number between 1 and ${totalPages}`);
      return;
    }
    setPageError("");
    setPage(p);
  }

  function renderPagination(options: { marginTop: number; marginBottom: number }) {
    if (total <= 0) return null;
    return (
      <div className="filter-bar" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: options.marginTop, marginBottom: options.marginBottom }}>
        <button className="btn outline" onClick={() => setPage(page - 1)} disabled={loading || page <= 1}>Prev</button>
        {(() => {
          const pages: Array<number | string> = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else if (page <= 4) {
            pages.push(1, 2, 3, 4, 5, "...", totalPages);
          } else if (page >= totalPages - 3) {
            pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
          } else {
            pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
          }
          return pages.map((entry, index) => (
            <button
              key={`${entry}-${index}`}
              className={entry === page ? "btn-primary" : "btn outline"}
              onClick={() => typeof entry === "number" && entry !== page ? setPage(entry) : undefined}
              disabled={loading || entry === "..."}
              style={{
                minWidth: 36, textAlign: "center",
                cursor: entry === "..." || entry === page ? "default" : "pointer",
                padding: "6px 12px", background: entry === "..." ? "transparent" : undefined,
                border: entry === "..." ? "none" : undefined, opacity: entry === "..." ? 0.7 : undefined,
              }}
            >{entry}</button>
          ));
        })()}
        <button className="btn outline" onClick={() => setPage(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        <span className="muted" style={{ marginLeft: 16, fontSize: 13, color: "var(--muted)" }}>Page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => { setPageInput(e.target.value); setPageError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") goToPage(pageInput); }}
          placeholder={`1–${totalPages}`}
          className="input"
          style={{ width: 70, padding: "5px 8px", fontSize: 13 }}
        />
        <button className="btn outline" onClick={() => goToPage(pageInput)} style={{ padding: "5px 12px", fontSize: 13 }}>Go</button>
        {pageError && <span className="form-error" style={{ fontSize: 12, marginLeft: 6, color: "var(--danger)" }}>{pageError}</span>}
      </div>
    );
  }
}
