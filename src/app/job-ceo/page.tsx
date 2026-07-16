"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

interface RunRow {
  id: string;
  status: string;
  source: string | null;
  trigger_type: string | null;
  ingested_count: number;
  kept_count: number;
  researched_count: number;
  matched_count: number;
  logged_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "ingesting": return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900 text-blue-200">Ingesting</span>;
    case "qa": return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-200">QA</span>;
    case "deep_fetch": return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-200">Deep Fetch</span>;
    case "matchmaking": return <span className="text-xs px-2 py-0.5 rounded-full bg-green-900 text-green-200">Matchmaking</span>;
    case "completed": return <span className="text-xs px-2 py-0.5 rounded-full bg-green-800 text-green-100">Completed</span>;
    case "failed": return <span className="text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-200">Failed</span>;
    case "cancelled": return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">Cancelled</span>;
    default: return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">{status}</span>;
  }
}

function isLive(status: string) {
  return !["completed", "failed", "cancelled"].includes(status);
}

export default function JobCeoPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [needsDispatch, setNeedsDispatch] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchRuns() {
    try {
      const res = await fetch("/api/job-ceo/runs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      // ignore poll errors
    }
  }

  useEffect(() => {
    fetchRuns();
    pollRef.current = setInterval(async () => {
      await fetchRuns();
    }, 6000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleTrigger() {
    setTriggering(true);
    try {
      const res = await fetch("/api/job-ceo/trigger", { method: "POST" });
      if (res.ok) {
        await fetchRuns();
      }
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  const activeRuns = runs.filter((r) => isLive(r.status));
  const hasActive = activeRuns.length > 0;

  useEffect(() => {
    if (hasActive) {
      const nd = activeRuns.some((r) => isLive(r.status));
      setNeedsDispatch(nd);
    }
  }, [runs, hasActive]);

  useEffect(() => {
    if (needsDispatch) {
      fetch("/api/job-ceo/dispatch", { method: "POST" }).catch(() => {});
      setNeedsDispatch(false);
    }
  }, [needsDispatch]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Job CEO</h1>
          <p className="text-sm text-ink-soft mt-1">Multi-agent job ingestion pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/job-ceo/proposals"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors"
          >
            Proposals
          </Link>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {triggering ? "Triggering..." : "Trigger Run"}
          </button>
        </div>
      </div>

      {hasActive && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-ink mb-3">Active Runs</h2>
          {activeRuns.map((run) => (
            <div key={run.id} className="p-4 rounded-lg border border-border bg-bg mb-3">
              <div className="flex items-center gap-3 mb-3">
                <span className={`pipeline-live-dot${isLive(run.status) ? " pipeline-live-dot-running" : ""}`} />
                <span className="font-mono text-xs text-ink-soft">{run.id.slice(0, 8)}</span>
                {statusBadge(run.status)}
              </div>

              <div className="flex gap-4">
                <div className="flex-1 text-center p-2 rounded bg-surface border border-border">
                  <div className="text-lg font-bold text-ink">{run.ingested_count}</div>
                  <div className="text-xs text-ink-soft">Ingested</div>
                </div>
                <div className="flex-1 text-center p-2 rounded bg-surface border border-border">
                  <div className="text-lg font-bold text-ink">{run.kept_count}</div>
                  <div className="text-xs text-ink-soft">Kept</div>
                </div>
                <div className="flex-1 text-center p-2 rounded bg-surface border border-border">
                  <div className="text-lg font-bold text-ink">{run.researched_count}</div>
                  <div className="text-xs text-ink-soft">Researched</div>
                </div>
                <div className="flex-1 text-center p-2 rounded bg-surface border border-border">
                  <div className="text-lg font-bold text-ink">{run.matched_count}</div>
                  <div className="text-xs text-ink-soft">Matched</div>
                </div>
                <div className="flex-1 text-center p-2 rounded bg-surface border border-border">
                  <div className="text-lg font-bold text-ink">{run.logged_count}</div>
                  <div className="text-xs text-ink-soft">Logged</div>
                </div>
              </div>

              {run.last_error && (
                <div className="mt-3 p-2 rounded bg-red-950 border border-red-800">
                  <p className="text-xs text-red-300 font-mono">{run.last_error}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-ink mb-3">Run History</h2>
        <div className="table-shell overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-ink-soft p-2">ID</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Status</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Source</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Ingested</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Kept</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Researched</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Matched</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Logged</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-sm text-ink-soft py-8">
                    No runs yet. Trigger a run to get started.
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border/50 hover:bg-surface/50">
                  <td className="font-mono text-xs text-ink p-2">{run.id.slice(0, 8)}</td>
                  <td className="p-2">{statusBadge(run.status)}</td>
                  <td className="text-xs text-ink-soft p-2">{run.source ?? "-"}</td>
                  <td className="text-right text-xs text-ink p-2">{run.ingested_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.kept_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.researched_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.matched_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.logged_count}</td>
                  <td className="text-xs text-ink-soft p-2">
                    {new Date(run.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  );
}
