"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { TableSkeleton } from "../../Skeleton";

interface Run {
  id: string;
  status: string;
  started_at: string;
  best_count: number;
  medium_count: number;
  worthy_count: number;
  skip_count: number;
  staged_count: number;
  actor_source?: string;
}
interface StagedJob {
  id: string;
  run_id: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
  salary_range: string | null;
  date_posted: string | null;
  source_url: string | null;
  apply_link: string | null;
  role_group_label: string | null;
  seniority_guess: string | null;
  tier: string | null;
  tier_reason: string | null;
  ai_keywords: string[] | null;
  relevance_score: number | null;
  is_false_positive: boolean;
  import_status: string;
  imported_job_id: string | null;
}

const TIER: Record<string, { bg: string; color: string; label: string }> = {
  best:   { bg: "#dcfce7", color: "#166534", label: "Best" },
  medium: { bg: "#fef9c3", color: "#854d0e", label: "Medium" },
  worthy: { bg: "#dbeafe", color: "#1e40af", label: "Worthy" },
  skip:   { bg: "#fee2e2", color: "#991b1b", label: "Skip" },
};

function toNum(v: unknown): number { return typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0; }
function pct(v: unknown): string { const n = toNum(v); return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—"; }
function isRunActive(r: Run | undefined): boolean {
  return !!r && ["running", "pending", "processing"].includes(r.status);
}

const PAGE_SIZE = 25;

export default function JobAgentReviewPage() {
  const [runs, setRuns]       = useState<Run[]>([]);
  const [runId, setRunId]     = useState("");
  const [jobs, setJobs]       = useState<StagedJob[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [msg, setMsg]         = useState("");
  const [tierF, setTierF]     = useState("");
  const [statusF, setStatusF] = useState("");
  const [busy, setBusy]       = useState(false);
  const [isLive, setIsLive]   = useState(false);

  // Stable refs so the polling interval callback never captures stale values
  const runIdRef   = useRef(runId);
  const tierFRef   = useRef(tierF);
  const statusFRef = useRef(statusF);
  const pageRef    = useRef(page);
  runIdRef.current   = runId;
  tierFRef.current   = tierF;
  statusFRef.current = statusF;
  pageRef.current    = page;

  const fetchRuns = useCallback(async () => {
    const r = await fetch("/api/job-agent/runs").catch(() => null);
    if (r?.ok) { const d = await r.json().catch(() => []); setRuns(d ?? []); }
  }, []);

  const loadJobs = useCallback(async (pg: number, silent = false) => {
    const rId = runIdRef.current;
    if (!rId) return;
    if (!silent) setLoading(true);
    setError("");
    const p = new URLSearchParams();
    p.set("page", String(pg)); p.set("pageSize", String(PAGE_SIZE));
    if (tierFRef.current) p.set("tier", tierFRef.current);
    const importStatus = statusFRef.current === "accepted" ? "imported" : statusFRef.current === "rejected" ? "rejected" : undefined;
    if (importStatus) p.set("importStatus", importStatus);
    const r = await fetch(`/api/job-agent/runs/${rId}/staged-jobs?${p}`).catch(() => null);
    const d = await r?.json().catch(() => ({ items: [], total: 0 })) ?? { items: [], total: 0 };
    setJobs(d.items ?? []); setTotal(d.total ?? 0); setPage(pg);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);
  useEffect(() => { if (runId) loadJobs(1); }, [runId, tierF, statusF, loadJobs]);

  // Real-time polling every 8 s — silently updates both the run list and job list
  useEffect(() => {
    const tick = async () => {
      await fetchRuns();
      if (runIdRef.current) loadJobs(pageRef.current, true);
    };
    const interval = setInterval(tick, 8000);
    setIsLive(true);
    return () => { clearInterval(interval); setIsLive(false); };
  }, [fetchRuns, loadJobs]);

  const refreshAll = useCallback(() => {
    fetchRuns();
    if (runIdRef.current) loadJobs(pageRef.current);
  }, [fetchRuns, loadJobs]);

  async function bulkApprove(tier?: string | string[]) {
    setBusy(true); setError(""); setMsg("");
    let body: any = { approveAll: true };
    if (Array.isArray(tier))           body = { tiers: tier };
    else if (typeof tier === "string") body = { tier };
    const r = await fetch(`/api/job-agent/runs/${runId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error || "Approve failed"); return; }
    setMsg(`✓ ${d.imported ?? 0} sent to Job CEO, ${d.skipped ?? 0} skipped (already imported)`);
    refreshAll();
  }

  async function singleApprove(jobId: string) {
    setBusy(true); setError(""); setMsg("");
    const r = await fetch(`/api/job-agent/runs/${runId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: [jobId] })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error || "Approve failed"); return; }
    setMsg(`✓ ${d.imported ?? 0} sent to Job CEO`);
    refreshAll();
  }

  async function updateOne(jobId: string, s: string) {
    await fetch(`/api/job-agent/runs/${runId}/staged-jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, status: s })
    });
    loadJobs(pageRef.current);
  }

  const run        = runs.find((r) => r.id === runId);
  const runActive  = isRunActive(run);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function renderPagination() {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else if (page <= 4)              { pages.push(1, 2, 3, 4, 5, "...", totalPages); }
    else if (page >= totalPages - 3) { pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages); }
    else                             { pages.push(1, "...", page - 1, page, page + 1, "...", totalPages); }
    return (
      <div className="filter-bar" style={{ justifyContent: "center", alignItems: "center", gap: 8 }}>
        <button onClick={() => loadJobs(page - 1)} disabled={loading || page <= 1}>Prev</button>
        {pages.map((entry, i) => (
          <button key={`${entry}-${i}`} className={entry === page ? "btn-primary" : ""}
            onClick={() => typeof entry === "number" && entry !== page ? loadJobs(entry) : undefined}
            disabled={loading || entry === "..."}
            style={{ minWidth: 36, textAlign: "center", cursor: entry === "..." || entry === page ? "default" : "pointer", padding: "6px 12px", background: entry === "..." ? "transparent" : undefined, border: entry === "..." ? "none" : undefined, opacity: entry === "..." ? 0.7 : undefined }}>
            {entry}
          </button>
        ))}
        <button onClick={() => loadJobs(page + 1)} disabled={loading || page >= totalPages}>Next</button>
      </div>
    );
  }

  return (<>
    <div className="page-header">
      <h1>Review &amp; Approve</h1>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
        {isLive && (
          <span style={{ fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
            Live
          </span>
        )}
        <Link href="/job-agent" className="btn">&#8592; Back to Agent</Link>
      </div>
    </div>

    {error && <p className="form-error">{error}</p>}
    {msg   && <p style={{ color: "var(--accent)", fontSize: 13 }}>{msg}</p>}

    {/* Run selector + filters */}
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Select Run</span>
          <select value={runId} onChange={(e) => setRunId(e.target.value)} style={{ minWidth: 360, fontSize: 14 }}>
            <option value="">-- Choose a run --</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleString()} · {r.staged_count} staged · {r.best_count}B {r.medium_count}M {r.worthy_count}W{isRunActive(r) ? " (processing...)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Tier</span>
          <select value={tierF} onChange={(e) => setTierF(e.target.value)}>
            <option value="">All Tiers</option>
            <option value="best">Best</option>
            <option value="medium">Medium</option>
            <option value="worthy">Worthy</option>
            <option value="skip">Skip</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Status</span>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">All</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {runId && (
          <button onClick={() => loadJobs(pageRef.current)} disabled={loading} style={{ padding: "6px 12px", fontSize: 13, alignSelf: "flex-end" }}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        )}
      </div>
    </div>

    {runId && run && (<>
      {/* Bulk actions + tier summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Bulk Actions:</strong>
          <button className="btn-secondary text-sm px-2 py-1" onClick={() => bulkApprove("best")} disabled={busy || !run.pending_best_count}>
            Approve All Best{run.pending_best_count > 0 ? ` (${run.pending_best_count})` : ""}
          </button>
          <button className="btn-secondary text-sm px-2 py-1" onClick={() => bulkApprove(["best", "medium"])} disabled={busy || (run.pending_best_count + run.pending_medium_count) === 0}>
            Best + Medium{(run.pending_best_count + run.pending_medium_count) > 0 ? ` (${run.pending_best_count + run.pending_medium_count})` : ""}
          </button>
          <button className="btn-secondary text-sm px-2 py-1" onClick={() => bulkApprove(["best", "worthy"])} disabled={busy || (run.pending_best_count + run.pending_worthy_count) === 0}>
            Best + Worthy{(run.pending_best_count + run.pending_worthy_count) > 0 ? ` (${run.pending_best_count + run.pending_worthy_count})` : ""}
          </button>
          <button onClick={() => bulkApprove()} disabled={busy}>Approve All Non-Skip</button>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
            {total} matching &middot; {run.staged_count} total staged
          </span>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 6, padding: "8px 12px", display: "flex", gap: 20, fontSize: 13, alignItems: "center" }}>
          <span>Best: <strong style={{ color: "#166534" }}>{run.best_count}</strong> {run.pending_best_count > 0 && <span className="muted">({run.pending_best_count} pending)</span>}</span>
          <span>Medium: <strong style={{ color: "#854d0e" }}>{run.medium_count}</strong> {run.pending_medium_count > 0 && <span className="muted">({run.pending_medium_count} pending)</span>}</span>
          <span>Worthy: <strong style={{ color: "#1e40af" }}>{run.worthy_count}</strong> {run.pending_worthy_count > 0 && <span className="muted">({run.pending_worthy_count} pending)</span>}</span>
          <span>Skip: <strong style={{ color: "#991b1b" }}>{run.skip_count}</strong> {run.pending_skip_count > 0 && <span className="muted">({run.pending_skip_count} pending)</span>}</span>
          {runActive && (
            <span style={{ marginLeft: "auto", color: "var(--warning)", fontSize: 12 }}>
              Run still processing — auto-updates every 8s
            </span>
          )}
        </div>
      </div>

      {total > 0 && renderPagination()}

      {loading ? <TableSkeleton cols={8} /> : jobs.length === 0 ? (
        <p className="muted" style={{ textAlign: "center", padding: 24 }}>
          {run.staged_count === 0
            ? "This run produced 0 unique new jobs — all scraped results were already in the database."
            : "No jobs match these filters."}
        </p>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Group</th><th>Tier</th><th>Score</th><th>Actions</th></tr></thead>
            <tbody>{jobs.map((job) => {
              const b   = TIER[job.tier ?? ""] ?? TIER.worthy;
              const imp = job.import_status === "imported";
              const rej = job.import_status === "rejected";
              const jobUrl = job.apply_link || job.source_url || "#";
              return (<tr key={job.id} style={{ opacity: imp || rej ? 0.55 : 1 }}>
                <td>
                  <a href={jobUrl} target="_blank" rel="noreferrer noopener" className="row-link">{job.job_title}</a>
                  {job.salary_range && <div className="muted" style={{ fontSize: 11 }}>{job.salary_range}</div>}
                  {job.is_false_positive && <span className="form-error" style={{ fontSize: 10 }}>False match</span>}
                  {job.tier_reason && <div className="muted" style={{ fontSize: 10, fontStyle: "italic" }}>{job.tier_reason}</div>}
                </td>
                <td className="muted">{job.company_name ?? "—"}</td>
                <td className="muted">{job.location ?? "—"}</td>
                <td>{job.role_group_label ?? "—"}</td>
                <td><span className="badge" style={{ background: b.bg, color: b.color }}>{b.label}</span></td>
                <td>{pct(job.relevance_score)}</td>
                <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {!imp && !rej && (<>
                    <button onClick={() => singleApprove(job.id)} disabled={busy} style={{ color: "var(--success)" }}>Approve</button>
                    <button onClick={() => updateOne(job.id, "rejected")} disabled={busy} style={{ color: "var(--danger)" }}>Reject</button>
                  </>)}
                  {!imp && rej && (
                    <button onClick={() => updateOne(job.id, "staged")} style={{ color: "var(--warning)" }}>Unreject</button>
                  )}
                  {imp && (
                    <span style={{ color: "var(--success)", fontSize: 13, fontWeight: 500 }}>Sent to Job CEO</span>
                  )}
                </td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      )}

      {total > 0 && renderPagination()}
    </>)}
  </>);
}
