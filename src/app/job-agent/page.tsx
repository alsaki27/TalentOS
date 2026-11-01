"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TableSkeleton } from "../Skeleton";

interface Run {
  id: string; config_id: string; status: string; actor_source: string; trigger_type: string;
  batch_id: string | null; date_interval: string | null; window_start: string | null; window_end: string | null;
  search_queries_ran: string[] | null; cancel_requested_at: string | null;
  poll_failure_count: number; consecutive_poll_failure_count: number; last_poll_error: string | null;
  last_poll_error_at: string | null; last_polled_at: string | null;
  raw_count: number; deduped_count: number; imported_count: number; skipped_count: number;
  classified_count: number; estimated_cost_usd: number; error: string | null;
  role_groups_ran: string[] | null; started_at: string; completed_at: string | null;
  best_count: number; medium_count: number; worthy_count: number; skip_count: number; staged_count: number;
}
interface RoleGroup { id: string; label: string; resumeFamily: string; titles: string[]; }
interface KeywordGroup { id: string; label: string; keywords: string[]; }
interface NightlyActorProgress { total: number; terminal: number; succeeded: number; failed: number; retrying: number; active: number; attempts: number; }
interface NightlyBatchShard { shard_key: string; actor_source: "indeed" | "linkedin" | "google"; status: string; attempt_count: number; max_attempts: number; }
interface NightlyBatch {
  id: string;
  business_date: string;
  timezone: string;
  window_start: string;
  window_end: string;
  auto_import: boolean;
  status: string;
  expected_shards: number;
  terminal_shards: number;
  succeeded_shards: number;
  failed_shards: number;
  raw_count: number;
  accepted_count: number;
  date_excluded_count: number;
  date_exclusion_reasons: Record<string, number>;
  duplicate_count: number;
  classified_count: number;
  imported_count: number;
  last_error: string | null;
  errors: Array<Record<string, unknown>>;
  job_ceo_run_id: string | null;
  tier_counts: { best: number; medium: number; worthy: number; skip: number };
  actor_progress: Record<"indeed" | "linkedin" | "google", NightlyActorProgress>;
  shards: NightlyBatchShard[];
}

const JOB_AGENT_PAGE_SIZE = 10;

function JobAgentPagination({
  page,
  totalItems,
  pageSize = JOB_AGENT_PAGE_SIZE,
  disabled = false,
  label,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize?: number;
  disabled?: boolean;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPageInput("");
    setPageError("");
  }, [page]);

  if (totalItems === 0) return null;

  const pages: Array<number | string> = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : page <= 4
      ? [1, 2, 3, 4, 5, "…", totalPages]
      : page >= totalPages - 3
        ? [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, "…", page - 1, page, page + 1, "…", totalPages];

  function goToPage() {
    const nextPage = Number(pageInput);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) {
      setPageError(`Choose a page from 1 to ${totalPages}.`);
      return;
    }
    setPageError("");
    onPageChange(nextPage);
  }

  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <div className="job-agent-pagination">
      <span className="job-agent-pagination-summary">Showing {firstItem}–{lastItem} of {totalItems} {label}</span>
      <div className="job-agent-pagination-controls">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>Prev</button>
        {pages.map((entry, index) => (
          <button
            type="button"
            key={`${entry}-${index}`}
            className={entry === page ? "btn-primary" : ""}
            onClick={() => typeof entry === "number" && onPageChange(entry)}
            disabled={disabled || entry === "…" || entry === page}
            aria-current={entry === page ? "page" : undefined}
          >{entry}</button>
        ))}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= totalPages}>Next</button>
        <label className="job-agent-page-jump">
          <span>Page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") goToPage(); }}
            aria-label={`Go to ${label} page`}
          />
          <button type="button" onClick={goToPage} disabled={disabled}>Go</button>
        </label>
      </div>
      {pageError && <span className="form-error job-agent-pagination-error">{pageError}</span>}
    </div>
  );
}

const NIGHTLY_ACTORS = [
  { id: "indeed", label: "Indeed" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "google", label: "Google" },
] as const;

function dateExclusionSummary(reasons: Record<string, number> | null | undefined): string {
  const entries = Object.entries(reasons ?? {}).filter(([, count]) => Number(count) > 0);
  if (entries.length === 0) return "None";
  return entries.map(([reason, count]) => `${reason.replaceAll("_", " ")}: ${count}`).join(" · ");
}

function nightlyShardTitle(batch: NightlyBatch, actor: string): string {
  return batch.shards
    .filter((shard) => shard.actor_source === actor)
    .map((shard) => `${shard.shard_key}: ${shard.status} (attempt ${shard.attempt_count}/${shard.max_attempts})`)
    .join("\n");
}

function groupLabel(raw: string[] | string | null): { short: string; full: string } {
  let ids: string[];
  if (!raw) { ids = []; }
  else if (typeof raw === "string") { ids = raw.replace(/[{}"]/g, "").split(",").map((s) => s.trim()).filter(Boolean); }
  else if (Array.isArray(raw)) { ids = raw.map(String).filter(Boolean); }
  else { ids = []; }

  if (ids.length === 0) return { short: "Custom", full: "Custom keywords only" };
  const full = ids.join(", ");
  if (ids.length <= 3) return { short: full, full };
  return { short: `${ids.slice(0, 3).join(", ")} +${ids.length - 3}`, full };
}

export default function JobAgentPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [nightlyBatches, setNightlyBatches] = useState<NightlyBatch[]>([]);
  const [nightlyBatchError, setNightlyBatchError] = useState("");
  const [roleGroups, setRoleGroups] = useState<RoleGroup[]>([]);
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"controls" | "nightly" | "runs">("controls");
  const [nightlyPage, setNightlyPage] = useState(1);
  const [runPage, setRunPage] = useState(1);

  const [selectedRoleGroups, setSelectedRoleGroups] = useState<Set<string>>(new Set());
  const [selectedKeywordGroups, setSelectedKeywordGroups] = useState<Set<string>>(new Set());
  const [dateInterval, setDateInterval] = useState("today");
  const [selectedActorSources, setSelectedActorSources] = useState<Set<string>>(new Set(["indeed"]));
  const [running, setRunning] = useState(false);

  const [expandedRoleBrowser, setExpandedRoleBrowser] = useState(false);

  // Keyword group form
  const [kgForm, setKgForm] = useState({ id: "", label: "", keywordsText: "" });
  const [showKgForm, setShowKgForm] = useState(false);

  async function load() {
    const [runsRes, libRes, kgRes] = await Promise.allSettled([
      fetch("/api/job-agent/runs?limit=100"), fetch("/api/job-agent/role-library"), fetch("/api/job-agent/keyword-groups"),
    ]);
    if (runsRes.status === "fulfilled" && runsRes.value.ok) setRuns((await runsRes.value.json().catch(() => [])) ?? []);
    if (libRes.status === "fulfilled" && libRes.value.ok) {
      const d = await libRes.value.json().catch(() => ({}));
      setRoleGroups(d.groups ?? []);
    }
    if (kgRes.status === "fulfilled" && kgRes.value.ok) setKeywordGroups((await kgRes.value.json().catch(() => [])) ?? []);
  }

  async function loadNightlyBatches() {
    try {
      const response = await fetch("/api/job-agent/batches?limit=25");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load nightly batches");
      setNightlyBatches(data.batches ?? []);
      setNightlyBatchError("");
    } catch (error) {
      setNightlyBatchError(error instanceof Error ? error.message : "Could not load nightly batches");
    }
  }

  useEffect(() => { load().then(() => setLoading(false)); }, []);

  useEffect(() => {
    loadNightlyBatches();
    const interval = setInterval(loadNightlyBatches, 15000);
    return () => clearInterval(interval);
  }, []);

  // Real-time polling every 7 seconds
  useEffect(() => {
    const interval = setInterval(load, 7000);
    return () => clearInterval(interval);
  }, []);

  function trg(id: string) { setSelectedRoleGroups((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function tkg(id: string) { setSelectedKeywordGroups((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function runNow() {
    setRunning(true); setError(""); setMessage("");
    const groups = Array.from(selectedRoleGroups);
    const customKeywords = keywordGroups.filter((g) => selectedKeywordGroups.has(g.id)).flatMap((g) => g.keywords);
    const actorSources = Array.from(selectedActorSources);

    if (groups.length === 0 && customKeywords.length === 0) {
      setError("Select at least one role group or custom keyword group to run.");
      setRunning(false);
      return;
    }
    if (actorSources.length === 0) {
      setError("Select at least one source actor (Indeed, Google Jobs, or LinkedIn).");
      setRunning(false);
      return;
    }
    try {
      let runStarted = false;
      const res = await fetch("/api/job-agent/runs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleGroups: groups, customKeywords, dateInterval, actorSources })  });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Run failed");
      if (Array.isArray(d.runs)) {
        const started = d.runs.filter((run: any) => run.status === "running" || run.status === "pending");
        const failed = d.runs.filter((run: any) => run.status === "failed");
        if (started.length === 0 && failed.length > 0) {
          throw new Error(failed.map((run: any) => `${run.actorSource}: ${run.error || "failed to start"}`).join("; "));
        }
        runStarted = started.length > 0;
        setMessage(`${started.length} run(s) started: ${started.map((run: any) => `${run.actorSource}:${String(run.runId).slice(0, 8)}`).join(", ")}`);
        setError(failed.length > 0
          ? failed.map((run: any) => `${run.actorSource}: ${run.error || "failed to start"}`).join("; ")
          : "");
      } else {
        runStarted = Boolean(d.runId);
        setMessage(`Run started: ${d.runId}`);
      }
      if (runStarted) {
        setSelectedRoleGroups(new Set());
        setSelectedKeywordGroups(new Set());
        setSelectedActorSources(new Set(["indeed"]));
        setMessage((current) => `${current}. Selections reset to defaults.`);
      }
      load();
    } catch (err: any) { setError(err.message); }
    finally { setRunning(false); }
  }

  async function cancelRun(run: Run) {
    if (!confirm(`Stop the ${run.actor_source} Apify run ${run.id.slice(0, 8)} now? The actor will be aborted immediately.`)) return;
    setStoppingRunId(run.id); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/job-agent/runs/${run.id}/cancel`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not stop run");
      setMessage(d.status === "cancelled" ? "Apify run stopped." : "Stop requested. Apify is confirming the cancellation; status will refresh automatically.");
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setStoppingRunId(null); }
  }

  // Keyword group CRUD
  function startCreateKg() { setKgForm({ id: "", label: "", keywordsText: "" }); setShowKgForm(true); }
  function startEditKg(g: KeywordGroup) { setKgForm({ id: g.id, label: g.label, keywordsText: g.keywords.join(", ") }); setShowKgForm(true); }
  function cancelKg() { setShowKgForm(false); setKgForm({ id: "", label: "", keywordsText: "" }); }

  async function saveKg() {
    if (!kgForm.label.trim()) { setError("Label is required"); return; }
    const keywords = kgForm.keywordsText.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (keywords.length === 0) { setError("At least one keyword is required"); return; }
    const url = kgForm.id ? `/api/job-agent/keyword-groups/${kgForm.id}` : "/api/job-agent/keyword-groups";
    const method = kgForm.id ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: kgForm.label.trim(), keywords }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Save failed"); return; }
    cancelKg(); load();
  }
  async function deleteKg(id: string) {
    if (!confirm("Delete this keyword group?")) return;
    await fetch(`/api/job-agent/keyword-groups/${id}`, { method: "DELETE" });
    load();
  }

  const activeCount = runs.filter((r) => r.status === "running" || r.status === "pending" || r.status === "processing").length;
  const succeededCount = runs.filter((r) => r.status === "succeeded").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;
  const bestTotal = runs.reduce((sum, r) => sum + (r.best_count || 0), 0);
  const nightlyPageCount = Math.max(1, Math.ceil(nightlyBatches.length / JOB_AGENT_PAGE_SIZE));
  const runPageCount = Math.max(1, Math.ceil(runs.length / JOB_AGENT_PAGE_SIZE));
  const visibleNightlyBatches = nightlyBatches.slice((nightlyPage - 1) * JOB_AGENT_PAGE_SIZE, nightlyPage * JOB_AGENT_PAGE_SIZE);
  const visibleRuns = runs.slice((runPage - 1) * JOB_AGENT_PAGE_SIZE, runPage * JOB_AGENT_PAGE_SIZE);

  useEffect(() => {
    setNightlyPage((page) => Math.min(page, nightlyPageCount));
  }, [nightlyPageCount]);

  useEffect(() => {
    setRunPage((page) => Math.min(page, runPageCount));
  }, [runPageCount]);

  return (
    <div className="job-agent-page">
    <div className="page-header job-agent-header-row">
      <div>
        <div className="job-agent-eyebrow">Automated sourcing</div>
        <h1>Job Agent</h1>
        <p className="page-kicker">Pull fresh roles from Indeed, Google Jobs, and LinkedIn, then review and approve before they go live.</p>
      </div>
      <Link href="/job-agent/review" className="btn btn-primary">Review & Approve →</Link>
    </div>
    {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
    {message && <p className="form-success" style={{ marginBottom: 12 }}>{message}</p>}

    <div className="stats-strip">
      <div className="stat-card"><span className="stat-label">Total runs</span><span className="stat-value">{runs.length}</span></div>
      <div className="stat-card"><span className="stat-label">Active now</span><span className="stat-value">{activeCount}</span></div>
      <div className="stat-card"><span className="stat-label">Succeeded</span><span className="stat-value">{succeededCount}</span></div>
      <div className="stat-card"><span className="stat-label">Failed</span><span className="stat-value">{failedCount}</span></div>
      <div className="stat-card"><span className="stat-label">Best-tier jobs</span><span className="stat-value">{bestTotal}</span></div>
    </div>

    <div className="job-agent-tabs" role="tablist" aria-label="Job Agent sections">
      <button type="button" role="tab" id="job-agent-tab-controls" aria-controls="job-agent-panel-controls" aria-selected={activeTab === "controls"} className={activeTab === "controls" ? "active" : ""} onClick={() => setActiveTab("controls")}>
        Agent Controls
      </button>
      <button type="button" role="tab" id="job-agent-tab-nightly" aria-controls="job-agent-panel-nightly" aria-selected={activeTab === "nightly"} className={activeTab === "nightly" ? "active" : ""} onClick={() => setActiveTab("nightly")}>
        Nightly Automation <span className="job-agent-tab-count">{nightlyBatches.length}</span>
      </button>
      <button type="button" role="tab" id="job-agent-tab-runs" aria-controls="job-agent-panel-runs" aria-selected={activeTab === "runs"} className={activeTab === "runs" ? "active" : ""} onClick={() => setActiveTab("runs")}>
        Run Dashboard <span className="job-agent-tab-count">{activeCount ? `${activeCount} active` : runs.length}</span>
      </button>
    </div>

    {/* ── Agent Controls ── */}
    <div id="job-agent-panel-controls" role="tabpanel" aria-labelledby="job-agent-tab-controls" hidden={activeTab !== "controls"}>
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title" style={{ fontSize: 17 }}>Agent Controls</h2>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Role Groups</h3>
          <button onClick={() => {
            if (selectedRoleGroups.size === roleGroups.length) setSelectedRoleGroups(new Set());
            else setSelectedRoleGroups(new Set(roleGroups.map(g => g.id)));
          }} style={{ fontSize: 13, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, padding: 0 }}>
            {selectedRoleGroups.size === roleGroups.length ? "Deselect All" : "Select All"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 8 }}>
          {roleGroups.map((g) => (
            <label key={g.id} className="checkbox-row" style={{ fontSize: 14, opacity: selectedRoleGroups.has(g.id) ? 1 : 0.75, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: selectedRoleGroups.has(g.id) ? "var(--accent-soft)" : "transparent", border: `1px solid ${selectedRoleGroups.has(g.id) ? "rgba(var(--accent-rgb), 0.4)" : "var(--border)"}` }}>
              <input type="checkbox" checked={selectedRoleGroups.has(g.id)} onChange={() => trg(g.id)} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontWeight: selectedRoleGroups.has(g.id) ? 600 : 400, color: selectedRoleGroups.has(g.id) ? "var(--accent)" : "var(--ink)" }}>{g.id}: {g.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Custom Keyword Groups</h3>
          <button onClick={startCreateKg} className="btn-compact">+ New Group</button>
        </div>
        {keywordGroups.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>No custom keyword groups yet. Create one to add your own search queries.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            {keywordGroups.map((g) => (
              <div key={g.id} className="keyword-chip">
                <label className="checkbox-row" style={{ fontSize: 13.5 }}><input type="checkbox" checked={selectedKeywordGroups.has(g.id)} onChange={() => tkg(g.id)} />{g.label}</label>
                <button onClick={() => startEditKg(g)} className="keyword-chip-icon-btn" title="Edit">✎</button>
                <button onClick={() => deleteKg(g.id)} className="keyword-chip-icon-btn" style={{ color: "var(--danger)" }} title="Delete">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showKgForm && (
        <div style={{ marginBottom: 20, padding: 14, background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div className="field-group" style={{ marginBottom: 10 }}>
            <label>Group Name</label>
            <input value={kgForm.label} onChange={(e) => setKgForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. My Fiber Roles" />
          </div>
          <div className="field-group" style={{ marginBottom: 10 }}>
            <label>Keywords (comma, semicolon, or newline separated)</label>
            <textarea value={kgForm.keywordsText} onChange={(e) => setKgForm((f) => ({ ...f, keywordsText: e.target.value }))} placeholder="OSP Designer, Fiber Engineer, AutoCAD Drafter" style={{ width: "100%", height: 70, padding: 10 }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={saveKg}>{kgForm.id ? "Update" : "Create"}</button>
            <button onClick={cancelKg}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>Date Posted</h3>
        <select value={dateInterval} onChange={(e) => setDateInterval(e.target.value)} style={{ width: "auto", minWidth: 160 }}>
          <option value="today">Today</option>
          <option value="2 days">2 Days</option>
          <option value="7 days">7 Days</option>
          <option value="30 days">30 Days</option>
          <option value="any">Any Time</option>
        </select>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>Source Actors <span style={{ fontSize: 12, fontWeight: 400, color: "var(--ink-soft)" }}>(select one or more)</span></h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {([
            { id: "indeed",  label: "Indeed",    icon: "🔍" },
            { id: "google",  label: "Google Jobs", icon: "🌐" },
            { id: "linkedin",label: "LinkedIn",   icon: "💼" },
          ] as { id: string; label: string; icon: string }[]).map((actor) => {
            const active = selectedActorSources.has(actor.id);
            return (
              <label key={actor.id} className={`source-actor-chip${active ? " active" : ""}`}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => setSelectedActorSources((prev) => {
                    const next = new Set(prev);
                    if (next.has(actor.id)) next.delete(actor.id); else next.add(actor.id);
                    return next;
                  })}
                />
                {actor.icon} {actor.label}
              </label>
            );
          })}
        </div>
        {selectedActorSources.size > 1 && (
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8, margin: 0 }}>
            ⚠ Running multiple actors will automatically deduplicate results across sources.
          </p>
        )}
      </div>

      <button className="btn-primary run-now-btn" onClick={runNow} disabled={running}>{running ? "Running…" : "Run Now"}</button>
    </div>

    {/* ── Role Group Browser (collapsed) ── */}
    <div className="card" style={{ marginBottom: 16 }}>
      <button onClick={() => setExpandedRoleBrowser(!expandedRoleBrowser)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15, display: "flex", justifyContent: "space-between", gap: 12, padding: 0 }}>
        <span>Role Group Browser ({roleGroups.reduce((s, g) => s + g.titles.length, 0)} titles across {roleGroups.length} groups)</span>
        <span style={{ flexShrink: 0 }}>{expandedRoleBrowser ? "▲" : "▼"}</span>
      </button>
      {expandedRoleBrowser && (
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {roleGroups.map((g) => (
            <details key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
              <summary style={{ fontWeight: 500, cursor: "pointer", fontSize: 13.5 }}>Group {g.id}: {g.label} ({g.titles.length} titles)</summary>
              <div style={{ padding: "10px 0 0 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.titles.map((t) => <span key={t} className="badge">{t}</span>)}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
    </div>

    {/* Nightly batch progress stays visible so retries, filters, and handoff errors are auditable. */}
    <div id="job-agent-panel-nightly" role="tabpanel" aria-labelledby="job-agent-tab-nightly" hidden={activeTab !== "nightly"}>
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Nightly Automation</h2>
        <span className="muted" style={{ fontSize: 12 }}>12:00 AM Asia/Dhaka · 48-hour window</span>
      </div>
      {nightlyBatchError ? (
        <p className="form-error" style={{ fontSize: 12 }}>{nightlyBatchError}</p>
      ) : loading ? (
        <TableSkeleton cols={8} />
      ) : nightlyBatches.length === 0 ? (
        <p className="muted">No nightly batches yet.</p>
      ) : (
        <>
          <JobAgentPagination page={nightlyPage} totalItems={nightlyBatches.length} label="nightly batches" disabled={loading} onPageChange={setNightlyPage} />
          <div className="table-shell job-agent-table-shell">
          <table className="table job-agent-table job-agent-nightly-table">
            <thead>
              <tr>
                <th>Business Date</th>
                <th>Status</th>
                <th>Actor / Shards</th>
                <th>Raw / Accepted</th>
                <th>Date Excluded</th>
                <th>Duplicates</th>
                <th>Tiers</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
          {visibleNightlyBatches.map((batch) => {
                const isActive = ["creating", "launching", "running", "finalizing", "finalization_failed"].includes(batch.status);
                const isFailure = ["failed", "cancelled", "finalization_failed"].includes(batch.status);
                const windowTitle = `${new Date(batch.window_start).toLocaleString()} → ${new Date(batch.window_end).toLocaleString()}`;
                return (
                  <tr key={batch.id}>
                    <td data-label="Business date" title={`Immutable window: ${windowTitle}`}>
                      <div style={{ fontWeight: 600 }}>{String(batch.business_date).slice(0, 10)}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{batch.timezone}</div>
                    </td>
                    <td data-label="Status">
                      <span
                        className={`badge ${isFailure ? "badge-danger" : isActive ? "badge-warning" : ""}`}
                        style={isActive && !isFailure ? { animation: "pulse 1.5s infinite" } : undefined}
                      >
                        {batch.status.replaceAll("_", " ")}
                      </span>
                      <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                        {batch.terminal_shards}/{batch.expected_shards} terminal · {batch.succeeded_shards} ok · {batch.failed_shards} failed
                      </div>
                      {!batch.auto_import && <div className="muted" style={{ fontSize: 10 }}>Dry run · approval required</div>}
                      {(batch.last_error || batch.errors?.length > 0) && (
                        <div className="form-error" style={{ fontSize: 10, marginTop: 4 }} title={batch.last_error ?? undefined}>
                          {batch.last_error ?? `${batch.errors.length} recorded error(s)`}
                        </div>
                      )}
                    </td>
                    <td data-label="Actor / shards">
                      {NIGHTLY_ACTORS.map((actor) => {
                        const progress = batch.actor_progress[actor.id];
                        if (!progress) return null;
                        return (
                          <div key={actor.id} style={{ fontSize: 11, whiteSpace: "nowrap" }} title={nightlyShardTitle(batch, actor.id)}>
                            <strong>{actor.label}</strong> {progress.terminal}/{progress.total}
                            {progress.failed > 0 && <span style={{ color: "#991b1b" }}> · {progress.failed} failed</span>}
                            {progress.retrying > 0 && <span style={{ color: "#854d0e" }}> · {progress.retrying} retry</span>}
                            {progress.active > 0 && <span className="muted"> · {progress.active} active</span>}
                            {progress.attempts > progress.total && <span className="muted"> · {progress.attempts} attempts</span>}
                          </div>
                        );
                      })}
                    </td>
                    <td data-label="Results">
                      <strong>{batch.raw_count}</strong> / {batch.accepted_count}
                      <div className="muted" style={{ fontSize: 10 }}>{batch.classified_count} classified</div>
                    </td>
                    <td data-label="Date excluded">
                      <strong>{batch.date_excluded_count}</strong>
                      <div className="muted" style={{ fontSize: 10, maxWidth: 190 }}>
                        {dateExclusionSummary(batch.date_exclusion_reasons)}
                      </div>
                    </td>
                    <td data-label="Duplicates">{batch.duplicate_count}</td>
                    <td data-label="Tiers" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      <span style={{ color: "#166534" }}>B {batch.tier_counts.best}</span> ·{" "}
                      <span style={{ color: "#854d0e" }}>M {batch.tier_counts.medium}</span> ·{" "}
                      <span style={{ color: "#1e40af" }}>W {batch.tier_counts.worthy}</span> ·{" "}
                      <span style={{ color: "#991b1b" }}>S {batch.tier_counts.skip}</span>
                    </td>
                    <td data-label="Imported / Job CEO">
                      <strong>{batch.imported_count}</strong>
                      {batch.job_ceo_run_id && (
                        <div style={{ marginTop: 3 }}>
                          <Link href={`/job-ceo/runs/${batch.job_ceo_run_id}`} style={{ color: "var(--accent)", fontSize: 11 }}>
                            Job CEO {batch.job_ceo_run_id.slice(0, 8)} →
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <JobAgentPagination page={nightlyPage} totalItems={nightlyBatches.length} label="nightly batches" disabled={loading} onPageChange={setNightlyPage} />
        </>
      )}
    </div>
    </div>

    {/* ── Run Dashboard ── */}
    <div id="job-agent-panel-runs" role="tabpanel" aria-labelledby="job-agent-tab-runs" hidden={activeTab !== "runs"}>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="run-dashboard-header">
        <h2 className="section-title" style={{ margin: 0, fontSize: 17 }}>Run Dashboard</h2>
        <span className="muted" style={{ fontSize: 12 }}>Apify status refreshes automatically; failures stay visible here.</span>
      </div>

      {loading ? <TableSkeleton cols={10} /> : runs.length === 0 ? (
        <p className="muted">No runs yet. Select groups and click Run Now.</p>
      ) : (
        <>
          <JobAgentPagination page={runPage} totalItems={runs.length} label="runs" disabled={loading} onPageChange={setRunPage} />
          <div className="table-shell job-agent-table-shell">
          <table className="table job-agent-table job-agent-run-table">
            <thead><tr><th>Started</th><th>Source</th><th>Groups / search</th><th>Window</th><th>Results</th><th>Tiers</th><th>Status / actions</th></tr></thead>
            <tbody>
              {visibleRuns.map((run) => (
                <tr key={run.id}>
                  <td data-label="Started" className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(run.started_at).toLocaleString()}</td>
                  <td data-label="Source">
                    <span className="badge" style={{ textTransform: "uppercase" }}>
                      {run.actor_source === "google" ? "🌐 Google" : run.actor_source === "linkedin" ? "💼 LinkedIn" : "🔍 Indeed"}
                    </span>
                    <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>{run.batch_id ? "Nightly" : "Manual"}</div>
                  </td>
                  <td data-label="Groups / search" title={run.search_queries_ran?.join(", ") || groupLabel(run.role_groups_ran).full}>
                    {groupLabel(run.role_groups_ran).short}
                    {run.search_queries_ran?.length ? <div className="muted" style={{ fontSize: 10, maxWidth: 230, whiteSpace: "normal" }}>{run.search_queries_ran.slice(0, 3).join(", ")}{run.search_queries_ran.length > 3 ? ` +${run.search_queries_ran.length - 3} more` : ""}</div> : null}
                  </td>
                  <td data-label="Window" className="muted" style={{ whiteSpace: "nowrap", fontSize: 11 }}>
                    {run.date_interval === "any" ? "Any time" : run.window_start && run.window_end
                      ? <span title={`${new Date(run.window_start).toLocaleString()} to ${new Date(run.window_end).toLocaleString()}`}>
                          {run.date_interval ?? "Window"} · {new Date(run.window_start).toLocaleString()} – {new Date(run.window_end).toLocaleTimeString()}
                        </span>
                      : run.date_interval ?? "Historical"}
                  </td>
                  <td data-label="Results">
                    <div className="job-agent-metric-list">
                      <span><strong>{run.raw_count}</strong> raw</span>
                      <span><strong>{run.deduped_count}</strong> deduped</span>
                      <span><strong>{run.classified_count}</strong> classified</span>
                    </div>
                  </td>
                  <td data-label="Tiers">
                    <div className="job-agent-tier-list">
                      <span className="job-agent-tier-best">Best {run.best_count}</span>
                      <span className="job-agent-tier-medium">Medium {run.medium_count}</span>
                      <span className="job-agent-tier-worthy">Worthy {run.worthy_count}</span>
                      <span className="job-agent-tier-skip">Skip {run.skip_count}</span>
                    </div>
                  </td>
                  <td data-label="Status / actions" className="job-agent-run-status-cell">
                    <span className={`badge ${run.status === "succeeded" || run.status === "cancelled" ? "" : run.status === "running" || run.status === "pending" || run.status === "processing" ? "badge-warning" : "badge-danger"}`}
                      style={{ whiteSpace: "nowrap", ...(run.status === "running" || run.status === "processing" ? { animation: "pulse 1.5s infinite" } : undefined) }}>
                      {run.cancel_requested_at && run.status === "running" ? "⏹ stopping..." : run.status === "running" ? "⏳ scraping..." : run.status === "pending" ? "⏳ pending..." : run.status === "processing" ? "⚙ classifying..." : run.status}
                    </span>
                    {run.error && <div className="form-error" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 240, whiteSpace: "normal" }}>{run.error}</div>}
                    {run.last_poll_error && <div title={run.last_poll_error} className="form-error" style={{ fontSize: 10.5, marginTop: 4, maxWidth: 260, whiteSpace: "normal" }}>
                      Apify error {run.poll_failure_count}×{run.last_poll_error_at ? ` · ${new Date(run.last_poll_error_at).toLocaleString()}` : ""}
                      {run.consecutive_poll_failure_count > 0 ? ` · ${run.consecutive_poll_failure_count} consecutive` : run.last_polled_at ? ` · recovered ${new Date(run.last_polled_at).toLocaleTimeString()}` : ""}: {run.last_poll_error}
                    </div>}
                    {run.trigger_type === "manual" && !run.batch_id && (run.status === "running" || run.status === "pending") && (
                      <button
                        className="btn-compact"
                        style={{ marginTop: 6, color: "var(--danger)" }}
                        disabled={Boolean(run.cancel_requested_at) || stoppingRunId === run.id}
                        onClick={() => cancelRun(run)}
                        title="Immediately abort this Apify actor run"
                      >
                        {stoppingRunId === run.id || run.cancel_requested_at ? "Stopping…" : "Stop run"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <JobAgentPagination page={runPage} totalItems={runs.length} label="runs" disabled={loading} onPageChange={setRunPage} />
        </>
      )}
    </div>
    </div>
    </div>
  );
}
