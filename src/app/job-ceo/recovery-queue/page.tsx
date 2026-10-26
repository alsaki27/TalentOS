"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { toCsv, downloadCsv } from "@/lib/csv";

interface RecoveryRow {
  id: string;
  run_id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  external_job_id: string | null;
  snippet: string | null;
  raw: { source?: string; matched_keywords?: string[]; adzuna_redirect_url?: string | null } | null;
  last_error: string | null;
  recovery_retry_count: number;
  recovery_last_retried_at: string | null;
  created_at: string;
}

// Mirrors RECOVERY_RETRY_BACKOFF_HOURS / RECOVERY_RETRY_MAX_ATTEMPTS in
// jobCeoRecoveryRetryService.ts — only used here for an honest "next
// automatic retry" display, not to gate anything (the server enforces the
// real timer; this is display-only and must stay informational, not
// authoritative).
const BACKOFF_HOURS = [12, 24];

function nextAutoRetryLabel(row: RecoveryRow): string {
  if (row.recovery_retry_count >= BACKOFF_HOURS.length) return "No more automatic retries — use Retry Now or Resolve";
  const waitHours = BACKOFF_HOURS[row.recovery_retry_count];
  const since = row.recovery_last_retried_at ?? row.created_at;
  const dueAt = new Date(new Date(since).getTime() + waitHours * 3600 * 1000);
  const now = new Date();
  if (dueAt <= now) return "Due for automatic retry on the next scheduled run";
  const hoursLeft = Math.ceil((dueAt.getTime() - now.getTime()) / 3600000);
  return `Next automatic retry in ~${hoursLeft}h`;
}

function ResolveForm({ row, onDone }: { row: RecoveryRow; onDone: (runId: string) => void }) {
  const [descriptionText, setDescriptionText] = useState("");
  const [sourceUrl, setSourceUrl] = useState(row.source_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/job-ceo/recovery-queue/${row.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptionText, sourceUrl: sourceUrl || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to resolve");
        return;
      }
      onDone(data.runId);
    } catch (err: any) {
      setError(err.message ?? "Failed to resolve");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 p-3 rounded-lg border border-border bg-surface space-y-2">
      <div>
        <label className="text-xs font-medium text-ink-soft block mb-1">Corrected / better source URL (optional)</label>
        <input
          type="text"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://careers.example.com/job/123"
          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-ink focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-soft block mb-1">
          Full job description ({descriptionText.length} chars)
        </label>
        <textarea
          value={descriptionText}
          onChange={(e) => setDescriptionText(e.target.value)}
          rows={8}
          placeholder="Paste the full job description text here..."
          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-ink font-mono focus:outline-none focus:border-accent"
        />
      </div>
      {error && <p className="text-xs text-rose-400">⚠ {error}</p>}
      <button
        onClick={submit}
        disabled={submitting || descriptionText.trim().length === 0}
        className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting ? "Submitting..." : "Submit & re-enter QA"}
      </button>
    </div>
  );
}

const POLL_INTERVAL_MS = 25000;

export default function RecoveryQueuePage() {
  const [rows, setRows] = useState<RecoveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retryMessage, setRetryMessage] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/job-ceo/recovery-queue?limit=500", { cache: "no-store" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || res.statusText);
      }
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err.message ?? "Failed to load the recovery queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Reflects background progress — the scheduled retry workflow runs every
    // 15 minutes, but a human watching this page shouldn't have to keep
    // hitting Refresh to see what it already did.
    pollRef.current = setInterval(() => fetchData({ silent: true }), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  async function retryNow(row: RecoveryRow) {
    setRetryingIds((prev) => new Set(prev).add(row.id));
    setRetryMessage((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
    try {
      const res = await fetch(`/api/job-ceo/recovery-queue/${row.id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok && res.status !== 409) {
        setRetryMessage((prev) => ({ ...prev, [row.id]: data.error ?? "Retry failed" }));
        return;
      }
      if (data.outcome === "recovered") {
        setResolvedIds((prev) => new Set(prev).add(row.id));
        setRetryMessage((prev) => ({ ...prev, [row.id]: `✓ Recovered — sent to QA as run ${String(data.runId).slice(0, 8)}` }));
      } else if (data.outcome === "still_failing") {
        setRetryMessage((prev) => ({ ...prev, [row.id]: `Still failing: ${data.reason}` }));
        await fetchData({ silent: true }); // pulls the updated retry_count/last_error for this row
      } else {
        setRetryMessage((prev) => ({ ...prev, [row.id]: data.reason ?? "Not eligible for retry" }));
      }
    } catch (err: any) {
      setRetryMessage((prev) => ({ ...prev, [row.id]: err.message ?? "Retry failed" }));
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(row.id); return n; });
    }
  }

  function exportCsv() {
    const flat = rows.map((r) => ({
      title: r.title ?? "",
      company: r.company ?? "",
      location: r.location ?? "",
      source: r.raw?.source ?? "",
      why_stuck: r.last_error ?? "",
      source_url: r.source_url ?? "",
      external_job_id: r.external_job_id ?? "",
      matched_keywords: (r.raw?.matched_keywords ?? []).join("; "),
      retry_count: r.recovery_retry_count,
      last_retried_at: r.recovery_last_retried_at ?? "",
      discovered_at: r.created_at,
      staging_id: r.id,
    }));
    const csv = toCsv(flat, [
      "title", "company", "location", "source", "why_stuck", "source_url",
      "external_job_id", "matched_keywords", "retry_count", "last_retried_at", "discovered_at", "staging_id",
    ]);
    downloadCsv(`job-ceo-recovery-queue-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-ink">Recovery Queue</h1>
          <p className="text-sm text-ink-soft mt-1">
            Jobs discovered by any Job CEO source (Adzuna, OpenJobData, Actalent, Broadstaff, Job Agent) whose
            description could not be found or fetched. Jobs with a link are automatically retried on a backoff
            schedule (6h, 24h, 72h) — many recover on their own. Export the list to research further, retry one
            right now, or paste a recovered description to send it back through QA.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/job-ceo"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors"
          >
            Back to CEO
          </Link>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => fetchData()}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-soft mb-4">
        {total} job{total !== 1 ? "s" : ""} in the queue{rows.length < total ? ` (showing first ${rows.length})` : ""}
        &nbsp;· auto-refreshes every 25s
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-950 text-red-300 text-sm">{error}</div>
      )}

      {loading && <p className="text-sm text-ink-soft py-8 text-center">Loading...</p>}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-ink-soft py-8 text-center">
          Nothing in the recovery queue right now — every discovered job either got a full description or is still
          being processed.
        </p>
      )}

      {!loading &&
        rows.map((row) => {
          const isResolved = resolvedIds.has(row.id);
          const isRetrying = retryingIds.has(row.id);
          const canRetry = Boolean(row.source_url) && !isResolved;
          return (
            <div key={row.id} className={`p-3 rounded-lg border bg-bg mb-3 ${isResolved ? "border-emerald-700 opacity-60" : "border-border"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{row.title ?? "—"}</p>
                  <p className="text-xs text-ink-soft">
                    {row.company ?? "—"} &middot; {row.location ?? "—"} &middot; {row.raw?.source ?? "—"}
                  </p>
                  <p className="text-xs text-rose-400 mt-1">⚠ {row.last_error ?? "Unknown reason"}</p>
                  {(row.raw?.matched_keywords ?? []).length > 0 && (
                    <p className="text-xs text-ink-soft mt-1">
                      Matched: {(row.raw?.matched_keywords ?? []).join(", ")}
                    </p>
                  )}
                  {row.source_url && !isResolved && (
                    <p className="text-xs text-ink-soft mt-1">
                      Retried {row.recovery_retry_count}× &middot; {nextAutoRetryLabel(row)}
                    </p>
                  )}
                  {retryMessage[row.id] && (
                    <p className={`text-xs mt-1 ${retryMessage[row.id].startsWith("✓") ? "text-emerald-400" : "text-amber-400"}`}>
                      {retryMessage[row.id]}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-right">
                  <span className="text-xs text-ink-soft whitespace-nowrap">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                  {row.source_url ? (
                    <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                      Open link →
                    </a>
                  ) : (
                    <span className="text-xs text-ink-soft">No link found</span>
                  )}
                  {canRetry && (
                    <button
                      onClick={() => retryNow(row)}
                      disabled={isRetrying}
                      title="Re-fetch this exact page right now, bypassing the automatic backoff wait"
                      className="px-2 py-1 text-xs font-medium rounded border border-border text-ink-soft hover:text-ink hover:border-ink-soft transition-colors disabled:opacity-50"
                    >
                      {isRetrying ? "Retrying..." : "Retry Now"}
                    </button>
                  )}
                  {!isResolved && (
                    <button
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      className="px-2 py-1 text-xs font-medium rounded border border-accent text-accent hover:bg-accent/10 transition-colors"
                    >
                      {expandedId === row.id ? "Cancel" : "Resolve"}
                    </button>
                  )}
                  {isResolved && <span className="text-xs text-emerald-400">✓ Resubmitted</span>}
                </div>
              </div>

              {expandedId === row.id && !isResolved && (
                <ResolveForm
                  row={row}
                  onDone={(runId) => {
                    setResolvedIds((prev) => new Set(prev).add(row.id));
                    setExpandedId(null);
                    setRetryMessage((prev) => ({ ...prev, [row.id]: `✓ Recovered — sent to QA as run ${runId.slice(0, 8)}` }));
                  }}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}
