"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TableSkeleton } from "../Skeleton";
import { LiveFeedBoard } from "./LiveFeedBoard";

interface Run { id: string; config_id: string; status: string; raw_count: number; deduped_count: number; imported_count: number; skipped_count: number; classified_count: number; estimated_cost_usd: number; error: string | null; role_groups_ran: string[] | null; started_at: string; completed_at: string | null; best_count: number; medium_count: number; worthy_count: number; skip_count: number; staged_count: number; }
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
  const [cleaningUp, setCleaningUp] = useState(false);

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
    const [runsRes, libRes, kgRes, batchesRes] = await Promise.allSettled([
      fetch("/api/job-agent/runs"), fetch("/api/job-agent/role-library"), fetch("/api/job-agent/keyword-groups"), fetch("/api/job-agent/batches?limit=10"),
    ]);
    if (runsRes.status === "fulfilled" && runsRes.value.ok) setRuns((await runsRes.value.json().catch(() => [])) ?? []);
    if (libRes.status === "fulfilled" && libRes.value.ok) {
      const d = await libRes.value.json().catch(() => ({}));
      setRoleGroups(d.groups ?? []);
    }
    if (kgRes.status === "fulfilled" && kgRes.value.ok) setKeywordGroups((await kgRes.value.json().catch(() => [])) ?? []);
    if (batchesRes.status === "fulfilled" && batchesRes.value.ok) {
      const data = await batchesRes.value.json().catch(() => ({ batches: [] }));
      setNightlyBatches(data.batches ?? []);
      setNightlyBatchError("");
    } else if (batchesRes.status === "fulfilled") {
      const data = await batchesRes.value.json().catch(() => ({}));
      setNightlyBatchError(data.error ?? "Could not load nightly batches");
    } else {
      setNightlyBatchError("Could not load nightly batches");
    }
  }

  useEffect(() => { load().then(() => setLoading(false)); }, []);

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
      const res = await fetch("/api/job-agent/runs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleGroups: groups, customKeywords, dateInterval, actorSources })  });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Run failed");
      const msg = d.runs
        ? `${d.runs.length} run(s) started: ${d.runs.map((r: any) => `${r.actorSource}:${r.runId.slice(0,8)}`).join(", ")}`
        : `Run started: ${d.runId}`;
      setMessage(msg);
      load();
    } catch (err: any) { setError(err.message); }
    finally { setRunning(false); }
  }

  async function clearStuckRuns() {
    setCleaningUp(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/job-agent/runs/cleanup", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Cleanup failed");
      setMessage(d.cleanedUp > 0 ? `Cleared ${d.cleanedUp} stuck run(s).` : "No stuck runs found.");
      load();
    } catch (err: any) { setError(err.message); }
    finally { setCleaningUp(false); }
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

  return (<>
    <div className="page-header">
      <h1>Job Agent</h1>
      <Link href="/job-agent/review" className="btn" style={{ marginLeft: "auto" }}>Review & Approve →</Link>
    </div>
    {error && <p className="form-error">{error}</p>}
    {message && <p style={{ color: "var(--accent)", fontSize: 13 }}>{message}</p>}

    {/* ── Agent Controls ── */}
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Agent Controls</h2>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Role Groups</h3>
          <button onClick={() => {
            if (selectedRoleGroups.size === roleGroups.length) setSelectedRoleGroups(new Set());
            else setSelectedRoleGroups(new Set(roleGroups.map(g => g.id)));
          }} style={{ fontSize: 13, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 500 }}>
            {selectedRoleGroups.size === roleGroups.length ? "Deselect All" : "Select All"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 8 }}>
          {roleGroups.map((g) => (
            <label key={g.id} className="checkbox-row" style={{ fontSize: 14, opacity: selectedRoleGroups.has(g.id) ? 1 : 0.75, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <input type="checkbox" checked={selectedRoleGroups.has(g.id)} onChange={() => trg(g.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
              <span style={{ fontWeight: selectedRoleGroups.has(g.id) ? 600 : 400 }}>{g.id}: {g.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Custom Keyword Groups</h3>
          <button onClick={startCreateKg} style={{ fontSize: 12 }}>+ New Group</button>
        </div>
        {keywordGroups.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No custom keyword groups yet. Create one to add your own search queries.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            {keywordGroups.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <label className="checkbox-row" style={{ fontSize: 13 }}><input type="checkbox" checked={selectedKeywordGroups.has(g.id)} onChange={() => tkg(g.id)} />{g.label}</label>
                <button onClick={() => startEditKg(g)} style={{ fontSize: 10, padding: "1px 4px" }}>✎</button>
                <button onClick={() => deleteKg(g.id)} style={{ fontSize: 10, padding: "1px 4px", color: "var(--danger)" }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showKgForm && (
        <div style={{ marginBottom: 16, padding: 12, background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <label>Group Name</label>
            <input value={kgForm.label} onChange={(e) => setKgForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. My Fiber Roles" />
          </div>
          <div className="field-group" style={{ marginBottom: 8 }}>
            <label>Keywords (comma, semicolon, or newline separated)</label>
            <textarea value={kgForm.keywordsText} onChange={(e) => setKgForm((f) => ({ ...f, keywordsText: e.target.value }))} placeholder="OSP Designer, Fiber Engineer, AutoCAD Drafter" style={{ width: "100%", height: 60, padding: 8 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={saveKg}>{kgForm.id ? "Update" : "Create"}</button>
            <button onClick={cancelKg}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Date Posted</h3>
        <select value={dateInterval} onChange={(e) => setDateInterval(e.target.value)} className="input" style={{ width: "auto", padding: "4px 8px" }}>
          <option value="today">Today</option>
          <option value="2 days">2 Days</option>
          <option value="7 days">7 Days</option>
          <option value="30 days">30 Days</option>
          <option value="any">Any Time</option>
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Source Actors <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>(select one or more)</span></h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {([
            { id: "indeed",  label: "Indeed",    icon: "🔍" },
            { id: "google",  label: "Google Jobs", icon: "🌐" },
            { id: "linkedin",label: "LinkedIn",   icon: "💼" },
          ] as { id: string; label: string; icon: string }[]).map((actor) => (
            <label key={actor.id} className="checkbox-row" style={{ fontSize: 13, opacity: selectedActorSources.has(actor.id) ? 1 : 0.65, fontWeight: selectedActorSources.has(actor.id) ? 600 : 400 }}>
              <input
                type="checkbox"
                checked={selectedActorSources.has(actor.id)}
                onChange={() => setSelectedActorSources((prev) => {
                  const next = new Set(prev);
                  if (next.has(actor.id)) next.delete(actor.id); else next.add(actor.id);
                  return next;
                })}
              />
              {actor.icon} {actor.label}
            </label>
          ))}
        </div>
        {selectedActorSources.size > 1 && (
          <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, margin: 0 }}>
            ⚠ Running multiple actors will automatically deduplicate results across sources.
          </p>
        )}
      </div>

      <button className="btn-primary" onClick={runNow} disabled={running}>{running ? "Running…" : "Run Now"}</button>
    </div>

    {/* ── Role Group Browser (collapsed) ── */}
    <div className="card" style={{ marginBottom: 16 }}>
      <button onClick={() => setExpandedRoleBrowser(!expandedRoleBrowser)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15, display: "flex", justifyContent: "space-between", padding: 0 }}>
        <span>Role Group Browser ({roleGroups.reduce((s, g) => s + g.titles.length, 0)} titles across {roleGroups.length} groups)</span>
        <span>{expandedRoleBrowser ? "▲" : "▼"}</span>
      </button>
      {expandedRoleBrowser && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {roleGroups.map((g) => (
            <details key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
              <summary style={{ fontWeight: 500, cursor: "pointer", fontSize: 13 }}>Group {g.id}: {g.label} ({g.titles.length} titles)</summary>
              <div style={{ padding: "8px 0 0 0", display: "flex", flexWrap: "wrap", gap: 4 }}>
                {g.titles.map((t) => <span key={t} className="badge" style={{ fontSize: 11 }}>{t}</span>)}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>

    {/* Nightly batch visibility */}
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
        <div style={{ overflowX: "auto" }}>
          <table className="table">
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
              {nightlyBatches.map((batch) => {
                const isActive = ["creating", "launching", "running", "finalizing", "finalization_failed"].includes(batch.status);
                const isFailure = ["failed", "cancelled", "finalization_failed"].includes(batch.status);
                const windowTitle = `${new Date(batch.window_start).toLocaleString()} → ${new Date(batch.window_end).toLocaleString()}`;
                return (
                  <tr key={batch.id}>
                    <td title={`Immutable window: ${windowTitle}`}>
                      <div style={{ fontWeight: 600 }}>{String(batch.business_date).slice(0, 10)}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{batch.timezone}</div>
                    </td>
                    <td>
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
                    <td>
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
                    <td>
                      <strong>{batch.raw_count}</strong> / {batch.accepted_count}
                      <div className="muted" style={{ fontSize: 10 }}>{batch.classified_count} classified</div>
                    </td>
                    <td>
                      <strong>{batch.date_excluded_count}</strong>
                      <div className="muted" style={{ fontSize: 10, maxWidth: 190 }}>
                        {dateExclusionSummary(batch.date_exclusion_reasons)}
                      </div>
                    </td>
                    <td>{batch.duplicate_count}</td>
                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      <span style={{ color: "#166534" }}>B {batch.tier_counts.best}</span> ·{" "}
                      <span style={{ color: "#854d0e" }}>M {batch.tier_counts.medium}</span> ·{" "}
                      <span style={{ color: "#1e40af" }}>W {batch.tier_counts.worthy}</span> ·{" "}
                      <span style={{ color: "#991b1b" }}>S {batch.tier_counts.skip}</span>
                    </td>
                    <td>
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
      )}
    </div>

    {/* ── Run Dashboard ── */}
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Run Dashboard</h2>
        <button
          onClick={clearStuckRuns}
          disabled={cleaningUp}
          style={{ fontSize: 12, padding: "4px 10px", opacity: 0.7 }}
          title="Mark all stuck running/pending/processing runs as failed"
        >
          {cleaningUp ? "Clearing…" : "🧹 Clear Stuck Runs"}
        </button>
      </div>

      {/* Only show the live feed board for runs started within the last 30 minutes.
          Old stuck runs should NOT trigger the spinner forever. */}
      {runs.find((r) => {
        if (!(r.status === "running" || r.status === "pending" || r.status === "processing")) return false;
        const ageMs = Date.now() - new Date(r.started_at).getTime();
        return ageMs < 30 * 60 * 1000; // 30 minutes
      }) && (
        <LiveFeedBoard
          runId={runs.find((r) => {
            if (!(r.status === "running" || r.status === "pending" || r.status === "processing")) return false;
            const ageMs = Date.now() - new Date(r.started_at).getTime();
            return ageMs < 30 * 60 * 1000;
          })!.id}
          onComplete={() => load()}
        />
      )}

      {loading ? <TableSkeleton cols={10} /> : runs.length === 0 ? (
        <p className="muted">No runs yet. Select groups and click Run Now.</p>
      ) : (
        <table className="table" style={{ marginTop: runs.find(r => r.status === "running" || r.status === "pending" || r.status === "processing") ? 32 : 0 }}>
          <thead><tr><th>Date</th><th>Source</th><th>Groups</th><th>Raw</th><th>Deduped</th><th>Classified</th><th>Best</th><th>Medium</th><th>Worthy</th><th>Skip</th><th>Status</th></tr></thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="muted">{new Date(run.started_at).toLocaleString()}</td>
                <td>
                  <span className="badge" style={{ fontSize: 10, textTransform: "uppercase" }}>
                    {(run as any).actor_source === "google" ? "🌐 Google" : (run as any).actor_source === "linkedin" ? "💼 LinkedIn" : "🔍 Indeed"}
                  </span>
                </td>
                <td title={groupLabel(run.role_groups_ran).full}>{groupLabel(run.role_groups_ran).short}</td>
                <td>{run.raw_count}</td>
                <td>{run.deduped_count}</td>
                <td>{run.classified_count}</td>
                <td style={{ color: "#166534" }}>{run.best_count}</td>
                <td style={{ color: "#854d0e" }}>{run.medium_count}</td>
                <td style={{ color: "#1e40af" }}>{run.worthy_count}</td>
                <td style={{ color: "#991b1b" }}>{run.skip_count}</td>
                <td>
                  <span className={`badge ${run.status === "succeeded" ? "" : run.status === "running" || run.status === "pending" || run.status === "processing" ? "badge-warning" : "badge-danger"}`}
                    style={run.status === "running" || run.status === "processing" ? { animation: "pulse 1.5s infinite" } : undefined}>
                    {run.status === "running" ? "⏳ scraping..." : run.status === "pending" ? "⏳ pending..." : run.status === "processing" ? "⚙ classifying..." : run.status}
                  </span>
                  {run.error && <div className="form-error" style={{ fontSize: 11 }}>{run.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </>);
}
