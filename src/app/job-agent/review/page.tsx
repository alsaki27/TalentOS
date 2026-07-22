"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { TableSkeleton } from "../../Skeleton";

interface Run { id: string; status: string; started_at: string; best_count: number; medium_count: number; worthy_count: number; skip_count: number; staged_count: number; }
interface StagedJob { id: string; run_id: string; job_title: string; company_name: string | null; location: string | null; salary_range: string | null; date_posted: string | null; source_url: string | null; apply_link: string | null; role_group_label: string | null; seniority_guess: string | null; tier: string | null; tier_reason: string | null; ai_keywords: string[] | null; relevance_score: number | null; is_false_positive: boolean; import_status: string; imported_job_id: string | null; }

const TIER: Record<string, { bg: string; color: string; label: string }> = {
  best: { bg: "#dcfce7", color: "#166534", label: "Best" },
  medium: { bg: "#fef9c3", color: "#854d0e", label: "Medium" },
  worthy: { bg: "#dbeafe", color: "#1e40af", label: "Worthy" },
  skip: { bg: "#fee2e2", color: "#991b1b", label: "Skip" },
};

function toNum(v: unknown): number { return typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0; }
function pct(v: unknown): string { const n = toNum(v); return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—"; }

const PAGE_SIZE = 25;

export default function JobAgentReviewPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [jobs, setJobs] = useState<StagedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tierF, setTierF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(async (pg: number) => {
    setLoading(true); setError("");
    const p = new URLSearchParams(); p.set("page", String(pg)); p.set("pageSize", String(PAGE_SIZE));
    if (tierF) p.set("tier", tierF);
    const importStatus = statusF === "accepted" ? "imported" : statusF === "rejected" ? "rejected" : undefined;
    if (importStatus) p.set("importStatus", importStatus);
    const r = await fetch(`/api/job-agent/runs/${runId}/staged-jobs?${p}`);
    const d = await r.json().catch(() => ({ items: [], total: 0 }));
    setJobs(d.items ?? []); setTotal(d.total ?? 0); setPage(pg); setLoading(false);
  }, [runId, tierF, statusF]);

  useEffect(() => { fetch("/api/job-agent/runs").then((r) => { if (r.ok) r.json().then((d: any) => setRuns(d ?? [])); }); }, []);
  useEffect(() => { if (runId) loadJobs(1); }, [runId, loadJobs]);

  async function bulkApprove(tier?: string) {
    setBusy(true);
    const r = await fetch(`/api/job-agent/runs/${runId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tier ? { tier } : { approveAll: true }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error || "Failed"); return; }
    setMsg(`${d.imported ?? 0} imported, ${d.skipped ?? 0} skipped`);
    loadJobs(page);
    fetch("/api/job-agent/runs").then((r) => { if (r.ok) r.json().then((d: any) => setRuns(d ?? [])); });
  }

  async function singleApprove(jobId: string) {
    setBusy(true);
    const r = await fetch(`/api/job-agent/runs/${runId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: [jobId] }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error || "Failed"); return; }
    setMsg(`${d.imported ?? 0} imported, ${d.skipped ?? 0} skipped`);
    loadJobs(page);
    fetch("/api/job-agent/runs").then((r) => { if (r.ok) r.json().then((d: any) => setRuns(d ?? [])); });
  }

  async function updateOne(jobId: string, s: string) { await fetch(`/api/job-agent/runs/${runId}/staged-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, status: s }) }); loadJobs(page); }

  const run = runs.find((r) => r.id === runId);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function renderPagination() {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else if (page <= 4) { pages.push(1, 2, 3, 4, 5, "...", totalPages); }
    else if (page >= totalPages - 3) { pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages); }
    else { pages.push(1, "...", page - 1, page, page + 1, "...", totalPages); }
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
      <h1>Review & Approve</h1>
      <Link href="/job-agent" className="btn">← Back to Agent</Link>
    </div>
    {error && <p className="form-error">{error}</p>}
    {msg && <p style={{ color: "var(--accent)", fontSize: 13 }}>{msg}</p>}

    {/* Run selector + filters */}
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Select Run</span>
          <select value={runId} onChange={(e) => setRunId(e.target.value)} style={{ minWidth: 360, fontSize: 14 }}>
            <option value="">— Choose a run —</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{new Date(r.started_at).toLocaleString()} · {r.staged_count} staged · {r.best_count}B {r.medium_count}M {r.worthy_count}W</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Tier</span>
          <select value={tierF} onChange={(e) => setTierF(e.target.value)}>
            <option value="">All Tiers</option><option value="best">Best</option><option value="medium">Medium</option><option value="worthy">Worthy</option><option value="skip">Skip</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Status</span>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">All</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
    </div>

    {runId && run && (<>
      {/* Bulk actions + summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Bulk Actions:</strong>
          <button className="btn-primary" onClick={() => bulkApprove("best")} disabled={busy}>Approve All Best</button>
          <button onClick={async () => { setBusy(true); await bulkApprove("best"); await bulkApprove("medium"); setBusy(false); }} disabled={busy}>Approve Best + Medium</button>
          <button onClick={() => bulkApprove()} disabled={busy}>Approve All Non-Skip</button>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>{total} jobs</span>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 6, padding: "8px 12px", display: "flex", gap: 20, fontSize: 13 }}>
          <span>Best: <strong style={{ color: "#166534" }}>{run.best_count}</strong></span>
          <span>Medium: <strong style={{ color: "#854d0e" }}>{run.medium_count}</strong></span>
          <span>Worthy: <strong style={{ color: "#1e40af" }}>{run.worthy_count}</strong></span>
          <span>Skip: <strong style={{ color: "#991b1b" }}>{run.skip_count}</strong></span>
        </div>
      </div>

      {/* Top pagination */}
      {total > 0 && renderPagination()}

      {/* Jobs table */}
      {loading ? <TableSkeleton cols={8} /> : jobs.length === 0 ? (
        <p className="muted" style={{ textAlign: "center", padding: 24 }}>No jobs match these filters.</p>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Group</th><th>Tier</th><th>Score</th><th></th></tr></thead>
            <tbody>{jobs.map((job) => {
              const b = TIER[job.tier ?? ""] ?? TIER.worthy;
              const imp = job.import_status === "imported";
              const rej = job.import_status === "rejected";
              const jobUrl = job.apply_link || job.source_url || "#";
              return (<tr key={job.id} style={{ opacity: imp ? 0.5 : rej ? 0.5 : 1 }}>
                <td>
                  <a href={jobUrl} target="_blank" rel="noreferrer noopener" className="row-link">{job.job_title}</a>
                  {job.salary_range && <div className="muted" style={{ fontSize: 11 }}>{job.salary_range}</div>}
                  {job.is_false_positive && <span className="form-error" style={{ fontSize: 10 }}>⚠ False match</span>}
                  {job.tier_reason && <div className="muted" style={{ fontSize: 10, fontStyle: "italic" }}>{job.tier_reason}</div>}
                </td>
                <td className="muted">{job.company_name ?? "—"}</td>
                <td className="muted">{job.location ?? "—"}</td>
                <td>{job.role_group_label ?? "—"}</td>
                <td><span className="badge" style={{ background: b.bg, color: b.color }}>{b.label}</span></td>
                <td>{pct(job.relevance_score)}</td>
                <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {!imp && !rej && (<>
                    <button onClick={() => singleApprove(job.id)} style={{ color: "var(--success)" }}>Approve</button>
                    <button onClick={() => updateOne(job.id, "rejected")} style={{ color: "var(--danger)" }}>Reject</button>
                  </>)}
                  {!imp && rej && (
                    <button onClick={() => updateOne(job.id, "staged")} style={{ color: "var(--warning)" }}>Unreject</button>
                  )}
                  {imp && (
                    <span style={{ color: "var(--success)", fontSize: 13, fontWeight: 500 }}>✓ Sent to Job CEO</span>
                  )}

                </td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      )}

      {/* Bottom pagination */}
      {total > 0 && renderPagination()}
    </>)}
  </>);
}