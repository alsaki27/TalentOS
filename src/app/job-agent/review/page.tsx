"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { TableSkeleton } from "../../Skeleton";

type ActorSource = "indeed" | "linkedin" | "google";
type HistoryTab = "all" | "nightly" | "manual";

interface Run {
  id: string;
  status: string;
  started_at: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  batch_id?: string | null;
  actor_source?: string | null;
  trigger_type?: string | null;
  raw_count?: number;
  role_groups_ran?: string[] | null;
  error?: string | null;
  best_count: number;
  medium_count: number;
  worthy_count: number;
  skip_count: number;
  staged_count: number;
  pending_best_count: number;
  pending_medium_count: number;
  pending_worthy_count: number;
  pending_skip_count: number;
}

interface SourceProgress {
  total: number;
  terminal: number;
  succeeded: number;
  failed: number;
  retrying: number;
  active: number;
  attempts: number;
}

interface BatchShard {
  id: string;
  shard_key: string;
  last_run_id: string | null;
  actor_source: ActorSource;
  role_groups: string[];
  status: string;
  attempt_count: number;
  max_attempts: number;
  raw_count: number;
  accepted_count: number;
  imported_count: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface NightlyBatch {
  id: string;
  business_date: string;
  timezone: string;
  trigger_type: string;
  auto_import: boolean;
  status: string;
  expected_shards: number;
  terminal_shards: number;
  succeeded_shards: number;
  failed_shards: number;
  raw_count: number;
  accepted_count: number;
  imported_count: number;
  last_error: string | null;
  job_ceo_run_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  actor_progress: Partial<Record<ActorSource, SourceProgress>>;
  shards: BatchShard[];
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

const SOURCE_ORDER: ActorSource[] = ["indeed", "linkedin", "google"];
const SOURCE_META: Record<ActorSource, { label: string; Icon: LucideIcon }> = {
  indeed: { label: "Indeed", Icon: BriefcaseBusiness },
  linkedin: { label: "LinkedIn", Icon: Users },
  google: { label: "Google Jobs", Icon: Search },
};
const TIER: Record<string, { bg: string; color: string; label: string }> = {
  best:   { bg: "#dcfce7", color: "#166534", label: "Best" },
  medium: { bg: "#fef9c3", color: "#854d0e", label: "Medium" },
  worthy: { bg: "#dbeafe", color: "#1e40af", label: "Worthy" },
  skip:   { bg: "#fee2e2", color: "#991b1b", label: "Skip" },
};

function toNum(value: unknown): number {
  return typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : 0;
}

function pct(value: unknown): string {
  const number = toNum(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "—";
}

function isRunActive(run: Run | undefined): boolean {
  return !!run && ["running", "pending", "processing"].includes(run.status);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time not recorded"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatBusinessDate(value?: string | null): string {
  if (!value) return "Date not recorded";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function labelize(value?: string | null): string {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value?: string | null): string {
  const key = (value ?? "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return `ja-status--${key}`;
}

function SourceBadge({ source, compact = false }: { source?: string | null; compact?: boolean }) {
  const normalized = (source ?? "").toLowerCase() as ActorSource;
  const meta = SOURCE_META[normalized];
  if (!meta) return <span className="ja-source-badge"><Search size={15} /> {labelize(source)}</span>;
  const Icon = meta.Icon;
  return (
    <span className={`ja-source-badge ja-source-badge--${normalized}${compact ? " ja-source-badge--compact" : ""}`}>
      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  return <span className={`ja-status-pill ${statusClass(status)}`}>{labelize(status)}</span>;
}

function runKindLabel(run: Run): string {
  return run.trigger_type === "nightly" || run.trigger_type === "scheduled"
    ? "Individual scheduled run"
    : "Manual source run";
}

const PAGE_SIZE = 25;

export default function JobAgentReviewPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [batches, setBatches] = useState<NightlyBatch[]>([]);
  const [runId, setRunId] = useState("");
  const [jobs, setJobs] = useState<StagedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tierF, setTierF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [busy, setBusy] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("all");
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());

  const runIdRef = useRef(runId);
  const tierFRef = useRef(tierF);
  const statusFRef = useRef(statusF);
  const pageRef = useRef(page);
  runIdRef.current = runId;
  tierFRef.current = tierF;
  statusFRef.current = statusF;
  pageRef.current = page;

  const fetchHistory = useCallback(async () => {
    try {
      const [runsResponse, batchesResponse] = await Promise.all([
        fetch("/api/job-agent/runs?limit=100"),
        fetch("/api/job-agent/batches?limit=25"),
      ]);
      if (!runsResponse.ok) throw new Error("Could not load individual run history.");
      if (!batchesResponse.ok) throw new Error("Could not load nightly batch history.");
      const [runData, batchData] = await Promise.all([
        runsResponse.json(),
        batchesResponse.json(),
      ]);
      setRuns(Array.isArray(runData) ? runData : []);
      setBatches(Array.isArray(batchData?.batches) ? batchData.batches : []);
      setHistoryError("");
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "Could not load run history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async (requestedPage: number, silent = false) => {
    const selectedRunId = runIdRef.current;
    if (!selectedRunId) return;
    if (!silent) setLoading(true);
    setError("");
    const params = new URLSearchParams();
    params.set("page", String(requestedPage));
    params.set("pageSize", String(PAGE_SIZE));
    if (tierFRef.current) params.set("tier", tierFRef.current);
    const importStatus = statusFRef.current === "accepted"
      ? "imported"
      : statusFRef.current === "rejected"
        ? "rejected"
        : undefined;
    if (importStatus) params.set("importStatus", importStatus);

    const response = await fetch(`/api/job-agent/runs/${selectedRunId}/staged-jobs?${params}`).catch(() => null);
    const data = await response?.json().catch(() => ({ items: [], total: 0 })) ?? { items: [], total: 0 };
    if (!response?.ok) {
      setError(data.error ?? "Could not load staged jobs for this source run.");
      setJobs([]);
      setTotal(0);
      if (!silent) setLoading(false);
      return;
    }
    setJobs(data.items ?? []);
    setTotal(data.total ?? 0);
    setPage(requestedPage);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);
  useEffect(() => { if (runId) void loadJobs(1); }, [runId, tierF, statusF, loadJobs]);

  useEffect(() => {
    const tick = async () => {
      await fetchHistory();
      if (runIdRef.current) void loadJobs(pageRef.current, true);
    };
    const interval = setInterval(tick, 8000);
    setIsLive(true);
    return () => { clearInterval(interval); setIsLive(false); };
  }, [fetchHistory, loadJobs]);

  const refreshAll = useCallback(() => {
    void fetchHistory();
    if (runIdRef.current) void loadJobs(pageRef.current);
  }, [fetchHistory, loadJobs]);

  function selectRun(selectedId: string) {
    setRunId(selectedId);
    setMsg("");
    window.setTimeout(() => {
      document.getElementById("job-agent-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function toggleBatch(batchId: string) {
    setExpandedBatchIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  async function bulkApprove(tier?: string | string[]) {
    if (!runId) return;
    setBusy(true); setError(""); setMsg("");
    let body: Record<string, unknown> = { approveAll: true };
    if (Array.isArray(tier)) body = { tiers: tier };
    else if (typeof tier === "string") body = { tier };
    const response = await fetch(`/api/job-agent/runs/${runId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error || "Approve failed"); return; }
    setMsg(`✓ ${data.imported ?? 0} sent to Job CEO, ${data.skipped ?? 0} skipped (already imported)`);
    refreshAll();
  }

  async function singleApprove(jobId: string) {
    if (!runId) return;
    setBusy(true); setError(""); setMsg("");
    const response = await fetch(`/api/job-agent/runs/${runId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: [jobId] }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error || "Approve failed"); return; }
    setMsg(`✓ ${data.imported ?? 0} sent to Job CEO`);
    refreshAll();
  }

  async function updateOne(jobId: string, status: string) {
    const response = await fetch(`/api/job-agent/runs/${runId}/staged-jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, status }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Could not update this staged job.");
      return;
    }
    void loadJobs(pageRef.current);
  }

  const run = runs.find((item) => item.id === runId);
  const selectedBatch = run?.batch_id ? batches.find((batch) => batch.id === run.batch_id) : undefined;
  const runActive = isRunActive(run);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const individualRuns = runs.filter((item) => !item.batch_id);
  const visibleBatches = historyTab === "manual" ? [] : batches;
  const visibleRuns = historyTab === "nightly" ? [] : individualRuns;

  function renderPagination() {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let index = 1; index <= totalPages; index++) pages.push(index);
    } else if (page <= 4) pages.push(1, 2, 3, 4, 5, "…", totalPages);
    else if (page >= totalPages - 3) pages.push(1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    else pages.push(1, "…", page - 1, page, page + 1, "…", totalPages);
    return (
      <nav className="ja-review-pagination" aria-label="Staged jobs pages">
        <button className="btn-secondary" onClick={() => void loadJobs(page - 1)} disabled={loading || page <= 1}>Previous</button>
        <span className="ja-pagination-summary">Page {page} of {totalPages} · {total} jobs</span>
        <button className="btn-secondary" onClick={() => void loadJobs(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        <div className="ja-pagination-number-list">
          {pages.map((entry, index) => (
            <button key={`${entry}-${index}`} className={entry === page ? "ja-page-number is-current" : "ja-page-number"}
              onClick={() => typeof entry === "number" && entry !== page && void loadJobs(entry)}
              disabled={loading || entry === "…"} aria-current={entry === page ? "page" : undefined}>
              {entry}
            </button>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <main className="ja-review-page">
      <header className="ja-review-header">
        <div>
          <p className="ja-review-eyebrow">JOB AGENT</p>
          <h1>Run history &amp; review</h1>
          <p>Nightly scrapes are grouped together. Manual runs are listed by source and time.</p>
        </div>
        <div className="ja-review-header-actions">
          <span className="ja-live-indicator"><span className={isLive ? "is-live" : ""} />Updates every 8 seconds</span>
          <button className="btn-secondary ja-refresh-button" type="button" onClick={refreshAll}>
            <RefreshCw size={15} /> Refresh
          </button>
          <Link href="/job-agent" className="btn ja-back-button">Agent controls</Link>
        </div>
      </header>

      {historyError && (
        <div className="ja-review-alert" role="alert"><AlertCircle size={18} />{historyError}</div>
      )}
      {error && <p className="form-error ja-review-message" role="alert">{error}</p>}
      {msg && <p className="ja-review-success" role="status">{msg}</p>}

      <section className="ja-history-panel" aria-labelledby="ja-history-title">
        <div className="ja-history-heading">
          <div>
            <div className="ja-section-kicker"><Layers3 size={14} /> ACTIVITY</div>
            <h2 id="ja-history-title">Scrape history</h2>
            <p>One card per nightly batch, with each source and its run details inside.</p>
          </div>
          <div className="ja-history-tabs" role="tablist" aria-label="Run history type">
            {([
              ["all", "All", batches.length + individualRuns.length],
              ["nightly", "Nightly", batches.length],
              ["manual", "Manual sources", individualRuns.length],
            ] as [HistoryTab, string, number][]).map(([tab, label, count]) => (
              <button key={tab} role="tab" aria-selected={historyTab === tab}
                className={historyTab === tab ? "is-active" : ""} onClick={() => setHistoryTab(tab)}>
                {label}<span>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {historyLoading ? (
          <div className="ja-history-loading"><Loader2 className="ja-spin" size={20} />Loading run history…</div>
        ) : visibleBatches.length === 0 && visibleRuns.length === 0 ? (
          <div className="ja-history-empty">
            <Layers3 size={24} />
            <strong>No runs in this view yet</strong>
            <span>New nightly batches and manual source runs will appear here.</span>
          </div>
        ) : (
          <div className="ja-history-list">
            {visibleBatches.map((batch) => {
              const expanded = expandedBatchIds.has(batch.id);
              const batchStarted = batch.started_at ? formatDateTime(batch.started_at) : formatBusinessDate(batch.business_date);
              const runMode = batch.trigger_type === "manual" ? "Manual test" : "Scheduled nightly";
              return (
                <article className="ja-batch-card" key={batch.id}>
                  <button className="ja-batch-summary" type="button" aria-expanded={expanded}
                    onClick={() => toggleBatch(batch.id)}>
                    <span className="ja-batch-icon"><Layers3 size={20} /></span>
                    <span className="ja-batch-main">
                      <span className="ja-batch-title-row">
                        <strong>{runMode} scrape</strong>
                        <StatusPill status={batch.status} />
                      </span>
                      <span className="ja-batch-date"><CalendarDays size={14} />{batchStarted}</span>
                      <span className="ja-batch-subtitle">
                        {batch.expected_shards} source runs · {batch.terminal_shards}/{batch.expected_shards} finished
                        {batch.auto_import ? " · automatic Job CEO handoff enabled" : " · review-only test"}
                      </span>
                    </span>
                    <span className="ja-batch-metrics">
                      <span><strong>{batch.raw_count}</strong><small>raw</small></span>
                      <span><strong>{batch.accepted_count}</strong><small>accepted</small></span>
                      <span><strong>{batch.imported_count}</strong><small>imported</small></span>
                    </span>
                    <ChevronDown className={expanded ? "ja-chevron is-open" : "ja-chevron"} size={19} />
                  </button>

                  <div className="ja-batch-source-summary">
                    {SOURCE_ORDER.map((source) => {
                      const progress = batch.actor_progress?.[source];
                      if (!progress?.total) return null;
                      return (
                        <div className="ja-source-progress" key={source}>
                          <SourceBadge source={source} />
                          <span className="ja-source-progress-count">{progress.terminal}/{progress.total} done</span>
                          {progress.active > 0 && <span className="ja-mini-state is-active">{progress.active} active</span>}
                          {progress.retrying > 0 && <span className="ja-mini-state is-retrying">{progress.retrying} retrying</span>}
                          {progress.failed > 0 && <span className="ja-mini-state is-failed">{progress.failed} failed</span>}
                        </div>
                      );
                    })}
                  </div>

                  {expanded && (
                    <div className="ja-shard-list">
                      <div className="ja-shard-list-heading">
                        <strong>Source run details</strong>
                        <span>Review results for a source run to see its staged jobs.</span>
                      </div>
                      {batch.shards.map((shard) => (
                        <div className="ja-shard-row" key={shard.id}>
                          <SourceBadge source={shard.actor_source} compact />
                          <span className="ja-shard-groups">{shard.role_groups?.length ? `Groups ${shard.role_groups.join(", ")}` : "All configured groups"}</span>
                          <span className="ja-shard-time"><Clock3 size={13} />{formatDateTime(shard.started_at ?? shard.completed_at)}</span>
                          <StatusPill status={shard.status} />
                          <span className="ja-shard-counts">{shard.raw_count} raw · {shard.accepted_count} accepted</span>
                          {shard.last_error && <span className="ja-shard-error" title={shard.last_error}><AlertCircle size={13} />Issue recorded</span>}
                          <button className="btn-secondary ja-shard-review" type="button"
                            disabled={!shard.last_run_id} onClick={() => shard.last_run_id && selectRun(shard.last_run_id)}>
                            {shard.last_run_id ? "Review jobs" : "Waiting for run"}
                          </button>
                        </div>
                      ))}
                      {batch.last_error && <p className="ja-batch-error"><AlertCircle size={14} />{batch.last_error}</p>}
                    </div>
                  )}
                </article>
              );
            })}

            {visibleRuns.map((item) => {
              const source = item.actor_source ?? "";
              const selected = item.id === runId;
              return (
                <article className={`ja-manual-card${selected ? " is-selected" : ""}`} key={item.id}>
                  <div className="ja-manual-card-top">
                    <SourceBadge source={source} />
                    <StatusPill status={item.status} />
                  </div>
                  <div className="ja-manual-run-title">
                    <strong>{runKindLabel(item)}</strong>
                    <span><CalendarDays size={14} />{formatDateTime(item.started_at ?? item.created_at)}</span>
                  </div>
                  <div className="ja-manual-run-meta">
                    <span>{item.role_groups_ran?.length ? `Groups ${item.role_groups_ran.join(", ")}` : "No role groups recorded"}</span>
                    <span>{item.staged_count} staged</span>
                    <span>{item.raw_count ?? 0} raw</span>
                  </div>
                  {item.error && <p className="ja-run-error"><AlertCircle size={14} />{item.error}</p>}
                  <button className={selected ? "btn-primary ja-open-run" : "btn-secondary ja-open-run"}
                    type="button" onClick={() => selectRun(item.id)}>
                    {selected ? "Viewing these results" : "Review this source run"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {run && (
        <section className="ja-results-panel" id="job-agent-results" aria-labelledby="ja-results-title">
          <div className="ja-results-header">
            <div>
              <div className="ja-section-kicker"><CheckCircle2 size={14} /> STAGED RESULTS</div>
              <h2 id="ja-results-title">Review source results</h2>
              <div className="ja-selected-run-meta">
                <SourceBadge source={run.actor_source} />
                {selectedBatch && <span className="ja-parent-batch-label"><Layers3 size={13} />{selectedBatch.trigger_type === "manual" ? "Manual test batch" : "Nightly batch"} · {formatBusinessDate(selectedBatch.business_date)}</span>}
                <span><CalendarDays size={14} />{formatDateTime(run.started_at ?? run.created_at)}</span>
                <StatusPill status={run.status} />
              </div>
            </div>
            <button className="btn-secondary ja-clear-selection" type="button" onClick={() => { setRunId(""); setJobs([]); setTotal(0); }}>
              Close results
            </button>
          </div>

          {runActive && (
            <div className="ja-run-live-note"><Loader2 className="ja-spin" size={16} />This source is still processing. Results refresh automatically.</div>
          )}

          <div className="ja-results-toolbar">
            <div className="ja-results-filters">
              <label><span>Tier</span>
                <select value={tierF} onChange={(event) => setTierF(event.target.value)}>
                  <option value="">All tiers</option><option value="best">Best</option><option value="medium">Medium</option><option value="worthy">Worthy</option><option value="skip">Skip</option>
                </select>
              </label>
              <label><span>Status</span>
                <select value={statusF} onChange={(event) => setStatusF(event.target.value)}>
                  <option value="">All statuses</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option>
                </select>
              </label>
            </div>
            <div className="ja-bulk-actions">
              <span className="ja-bulk-label">Approve:</span>
              <button className="btn-secondary" onClick={() => void bulkApprove("best")} disabled={busy || !run.pending_best_count}>Best{run.pending_best_count > 0 ? ` (${run.pending_best_count})` : ""}</button>
              <button className="btn-secondary" onClick={() => void bulkApprove(["best", "medium"])} disabled={busy || (run.pending_best_count + run.pending_medium_count) === 0}>Best + Medium</button>
              <button className="btn-secondary" onClick={() => void bulkApprove() } disabled={busy}>All non-skip</button>
            </div>
          </div>

          <div className="ja-tier-summary">
            <span>Best <strong className="ja-tier-best">{run.best_count}</strong>{run.pending_best_count > 0 && <small>{run.pending_best_count} pending</small>}</span>
            <span>Medium <strong className="ja-tier-medium">{run.medium_count}</strong>{run.pending_medium_count > 0 && <small>{run.pending_medium_count} pending</small>}</span>
            <span>Worthy <strong className="ja-tier-worthy">{run.worthy_count}</strong>{run.pending_worthy_count > 0 && <small>{run.pending_worthy_count} pending</small>}</span>
            <span>Skip <strong className="ja-tier-skip">{run.skip_count}</strong>{run.pending_skip_count > 0 && <small>{run.pending_skip_count} pending</small>}</span>
            <span className="ja-result-total">{total} matching · {run.staged_count} staged in this source</span>
          </div>

          {total > 0 && renderPagination()}
          {loading ? <TableSkeleton cols={7} /> : jobs.length === 0 ? (
            <div className="ja-no-jobs">
              <Search size={21} />
              <strong>{run.staged_count === 0 ? "No unique new jobs in this source run" : "No jobs match these filters"}</strong>
              <span>{run.staged_count === 0 ? "The scraped results may already exist in TalentOS or were excluded during processing." : "Try widening the tier or status filters."}</span>
            </div>
          ) : (
            <div className="ja-results-table-wrap">
              <table className="ja-results-table">
                <thead><tr><th>Job</th><th>Company</th><th>Location</th><th>Group</th><th>Tier</th><th>Score</th><th>Actions</th></tr></thead>
                <tbody>{jobs.map((job) => {
                  const tier = TIER[job.tier ?? ""] ?? TIER.worthy;
                  const imported = job.import_status === "imported";
                  const rejected = job.import_status === "rejected";
                  const jobUrl = job.apply_link || job.source_url || "#";
                  return (
                    <tr key={job.id} className={imported || rejected ? "is-resolved" : ""}>
                      <td data-label="Job">
                        <a href={jobUrl} target="_blank" rel="noreferrer noopener" className="row-link">{job.job_title}</a>
                        {job.salary_range && <div className="muted ja-job-subline">{job.salary_range}</div>}
                        {job.is_false_positive && <span className="form-error ja-false-positive">Possible false match</span>}
                        {job.tier_reason && <div className="muted ja-job-reason">{job.tier_reason}</div>}
                      </td>
                      <td data-label="Company">{job.company_name ?? "—"}</td>
                      <td data-label="Location">{job.location ?? "—"}</td>
                      <td data-label="Group">{job.role_group_label ?? "—"}</td>
                      <td data-label="Tier"><span className="ja-tier-pill" style={{ background: tier.bg, color: tier.color }}>{tier.label}</span></td>
                      <td data-label="Score">{pct(job.relevance_score)}</td>
                      <td data-label="Actions" className="ja-job-actions">
                        {!imported && !rejected && <>
                          <button className="ja-approve-button" onClick={() => void singleApprove(job.id)} disabled={busy}>Approve</button>
                          <button className="ja-reject-button" onClick={() => void updateOne(job.id, "rejected")} disabled={busy}>Reject</button>
                        </>}
                        {!imported && rejected && <button className="ja-unreject-button" onClick={() => void updateOne(job.id, "staged")}>Restore</button>}
                        {imported && <span className="ja-imported-label"><CheckCircle2 size={14} />Sent to Job CEO</span>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {total > 0 && renderPagination()}
        </section>
      )}
    </main>
  );
}
