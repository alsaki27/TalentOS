"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface StagedRow {
  id: string;
  stage: string;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  qa_score: number | null;
  qa_reason: string | null;
  description_text: string | null;
  requirements: unknown;
  match_results: unknown;
  last_error: string | null;
  created_at: string;
}

interface StageCounts {
  ingested?: number;
  qa_passed?: number;
  qa_dropped?: number;
  researched?: number;
  matched?: number;
  logged?: number;
  error?: number;
}

const STAGE_COLORS: Record<string, string> = {
  ingested: "bg-blue-900 text-blue-200",
  qa_passed: "bg-emerald-900 text-emerald-200",
  qa_dropped: "bg-red-900 text-red-200",
  researched: "bg-purple-900 text-purple-200",
  matched: "bg-amber-900 text-amber-200",
  logged: "bg-green-800 text-green-100",
  error: "bg-rose-950 text-rose-300",
};

const STAGE_LABELS: Record<string, string> = {
  ingested: "Ingested",
  qa_passed: "QA Passed",
  qa_dropped: "QA Dropped",
  researched: "Researched",
  matched: "Matched",
  logged: "Logged",
  error: "Error",
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[stage] ?? "bg-gray-700 text-gray-300"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function QaScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-ink-soft">—</span>;
  const color =
    score >= 80 ? "text-emerald-400" :
    score >= 50 ? "text-amber-400" :
    "text-red-400";
  return <span className={`text-xs font-semibold ${color}`}>{score}</span>;
}

function ExpandedRow({ row }: { row: StagedRow }) {
  return (
    <tr>
      <td colSpan={8} className="bg-surface/50 border-b border-border px-4 pb-4 pt-2">
        <div className="grid grid-cols-1 gap-3">
          {row.qa_reason && (
            <div>
              <p className="text-xs font-semibold text-ink-soft mb-1">QA Reason</p>
              <p className="text-xs text-ink">{row.qa_reason}</p>
            </div>
          )}
          {row.last_error && (
            <div>
              <p className="text-xs font-semibold text-rose-400 mb-1">⚠ Error</p>
              <pre className="text-xs text-rose-300 font-mono bg-rose-950/60 p-2 rounded whitespace-pre-wrap">{row.last_error}</pre>
            </div>
          )}
          {row.description_text && (
            <div>
              <p className="text-xs font-semibold text-ink-soft mb-1">Description</p>
              <p className="text-xs text-ink line-clamp-6">{row.description_text}</p>
            </div>
          )}
          {row.requirements != null && (
            <div>
              <p className="text-xs font-semibold text-ink-soft mb-1">Requirements (AI Extracted)</p>
              <pre className="text-xs text-ink font-mono bg-surface p-2 rounded whitespace-pre-wrap overflow-auto max-h-40">
                {String(JSON.stringify(row.requirements, null, 2))}
              </pre>
            </div>
          )}
          {row.match_results != null && (
            <div>
              <p className="text-xs font-semibold text-ink-soft mb-1">Match Results</p>
              <pre className="text-xs text-ink font-mono bg-surface p-2 rounded whitespace-pre-wrap overflow-auto max-h-40">
                {String(JSON.stringify(row.match_results, null, 2))}
              </pre>
            </div>
          )}
          {row.source_url && (
            <div>
              <a
                href={row.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                View original posting →
              </a>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function JobCeoRunStagingPage() {
  const { id: runId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [counts, setCounts] = useState<StageCounts>({});
  const [activeStage, setActiveStage] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (stage: string) => {
    setLoading(true);
    setError(null);
    try {
      const stageParam = stage !== "all" ? `&stage=${stage}` : "";
      const res = await fetch(`/api/job-ceo/runs/${runId}/staging?limit=300${stageParam}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || res.statusText);
      }
      const data = await res.json();
      setRows(data.rows ?? []);
      setCounts(data.counts ?? {});
    } catch (err: any) {
      setError(err.message ?? "Failed to load staging data");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchData(activeStage);
  }, [activeStage, fetchData]);

  const totalAll = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const stages = ["all", "ingested", "qa_passed", "qa_dropped", "researched", "matched", "logged", "error"];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/job-ceo"
          className="text-xs text-ink-soft hover:text-ink transition-colors"
        >
          ← Back to Job CEO
        </Link>
        <span className="text-ink-soft">/</span>
        <span className="text-xs font-mono text-ink">{runId?.slice(0, 12)}...</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-ink">Staging Pipeline Viewer</h1>
          <p className="text-sm text-ink-soft mt-0.5">Live view of jobs moving through the multi-agent pipeline</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!confirm("Stop this run?")) return;
              await fetch(`/api/job-ceo/runs/${runId}/cancel`, { method: "POST" });
              // Refresh or navigate away
              window.location.href = "/job-ceo";
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-500 bg-surface text-red-500 hover:text-red-600 transition-colors"
          >
            Stop Run
          </button>
          <button
            onClick={() => fetchData(activeStage)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stage Count Cards */}
      <div className="grid grid-cols-4 md:grid-cols-7 gap-2 mb-5">
        {stages.filter((s) => s !== "all").map((stage) => {
          const count = (counts as any)[stage] ?? 0;
          return (
            <button
              key={stage}
              onClick={() => { setActiveStage(stage); setExpandedId(null); }}
              className={`p-2 rounded-lg border text-center transition-all ${
                activeStage === stage
                  ? "border-accent bg-accent/10"
                  : "border-border bg-bg hover:border-ink-soft"
              }`}
            >
              <div className="text-lg font-bold text-ink">{count}</div>
              <div className="text-xs text-ink-soft mt-0.5">{STAGE_LABELS[stage]}</div>
            </button>
          );
        })}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
        <button
          onClick={() => { setActiveStage("all"); setExpandedId(null); }}
          className={`px-3 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
            activeStage === "all"
              ? "bg-accent text-white"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          All ({totalAll})
        </button>
        {stages.filter((s) => s !== "all").map((stage) => {
          const count = (counts as any)[stage] ?? 0;
          if (count === 0 && activeStage !== stage) return null;
          return (
            <button
              key={stage}
              onClick={() => { setActiveStage(stage); setExpandedId(null); }}
              className={`px-3 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                activeStage === stage
                  ? "bg-accent text-white"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {STAGE_LABELS[stage]} ({count})
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-950 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="table-shell overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs font-medium text-ink-soft p-2">Title</th>
              <th className="text-left text-xs font-medium text-ink-soft p-2">Company</th>
              <th className="text-left text-xs font-medium text-ink-soft p-2">Location</th>
              <th className="text-left text-xs font-medium text-ink-soft p-2">Stage</th>
              <th className="text-center text-xs font-medium text-ink-soft p-2">QA Score</th>
              <th className="text-left text-xs font-medium text-ink-soft p-2">Details</th>
              <th className="text-left text-xs font-medium text-ink-soft p-2">Time</th>
              <th className="text-center text-xs font-medium text-ink-soft p-2">Expand</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-sm text-ink-soft py-10">
                  <div className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
                    Loading...
                  </div>
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-sm text-ink-soft py-10">
                  {activeStage === "all"
                    ? "No jobs in this run yet."
                    : `No jobs in stage: ${STAGE_LABELS[activeStage] ?? activeStage}`}
                </td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <>
                <tr
                  key={row.id}
                  className={`border-b border-border/50 hover:bg-surface/50 cursor-pointer transition-colors ${
                    expandedId === row.id ? "bg-surface/30" : ""
                  }`}
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <td className="p-2 max-w-xs">
                    <span className="text-xs text-ink font-medium line-clamp-2">{row.title ?? "—"}</span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-ink-soft">{row.company ?? "—"}</span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-ink-soft">{row.location ?? "—"}</span>
                  </td>
                  <td className="p-2">
                    <StageBadge stage={row.stage} />
                  </td>
                  <td className="p-2 text-center">
                    <QaScoreBadge score={row.qa_score} />
                  </td>
                  <td className="p-2 max-w-xs">
                    {row.last_error ? (
                      <span className="text-xs text-rose-400 truncate block max-w-xs" title={row.last_error}>
                        ⚠ {row.last_error.slice(0, 60)}...
                      </span>
                    ) : row.qa_reason ? (
                      <span className="text-xs text-ink-soft truncate block max-w-xs" title={row.qa_reason}>
                        {row.qa_reason.slice(0, 60)}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-ink-soft whitespace-nowrap">
                      {new Date(row.created_at).toLocaleTimeString()}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <span className="text-xs text-ink-soft">
                      {expandedId === row.id ? "▲" : "▼"}
                    </span>
                  </td>
                </tr>
                {expandedId === row.id && <ExpandedRow key={`${row.id}-expand`} row={row} />}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-xs text-ink-soft mt-3 text-right">
          Showing {rows.length} row{rows.length !== 1 ? "s" : ""}
          {activeStage !== "all" ? ` in stage "${STAGE_LABELS[activeStage] ?? activeStage}"` : ""}
        </p>
      )}
    </div>
  );
}
