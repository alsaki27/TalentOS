"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  skipped_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface KeywordGroup {
  id: string;
  label: string;
  keywords: string[];
}

interface RoleGroup {
  id: string;
  label: string;
  resumeFamily: string;
  titles: string[];
}

interface ScheduleRow {
  id: string | null;
  is_enabled: boolean;
  cron_expression: string;
  role_group: string;
  days_back: number;
  dry_run: boolean;
  notes: string | null;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ingesting: "bg-blue-900 text-blue-200",
    qa: "bg-yellow-900 text-yellow-200",
    deep_fetch: "bg-purple-900 text-purple-200",
    matchmaking: "bg-green-900 text-green-200",
    completed: "bg-green-800 text-green-100",
    failed: "bg-red-900 text-red-200",
    cancelled: "bg-gray-700 text-gray-300",
  };
  const labels: Record<string, string> = {
    ingesting: "Ingesting",
    qa: "QA",
    deep_fetch: "Deep Fetch",
    matchmaking: "Matchmaking",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? "bg-gray-700 text-gray-300"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function isLive(status: string) {
  return !["completed", "failed", "cancelled"].includes(status);
}

// Cron expression to human-readable
function cronToHuman(expr: string): string {
  try {
    const parts = expr.trim().split(" ");
    if (parts.length !== 5) return expr;
    const [min, hour] = parts;
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (isNaN(h) || isNaN(m)) return expr;
    const time = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} UTC`;
    return `Daily at ${time}`;
  } catch {
    return expr;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KeywordGroupSelector({
  groups,
  selectedIds,
  onChange,
  onEdit,
  onDelete,
}: {
  groups: KeywordGroup[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  onEdit?: (g: KeywordGroup) => void;
  onDelete?: (id: string) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
      {groups.map((g) => (
        <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <label className="checkbox-row" style={{ fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <input 
              type="checkbox" 
              checked={selectedIds.has(g.id)} 
              onChange={() => toggle(g.id)} 
              className="w-3.5 h-3.5 accent-accent"
            />
            {g.label}
          </label>
          {onDelete && (
            <button onClick={() => onDelete(g.id)} style={{ fontSize: 10, padding: "1px 4px", color: "var(--danger)" }}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ScheduleCard({
  schedule,
  onSave,
  saving,
}: {
  schedule: ScheduleRow;
  onSave: (patch: Partial<ScheduleRow>) => Promise<void>;
  saving: boolean;
}) {
  const [local, setLocal] = useState(schedule);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setLocal(schedule); setDirty(false); }, [schedule]);

  const update = (patch: Partial<ScheduleRow>) => {
    setLocal((l) => ({ ...l, ...patch }));
    setDirty(true);
  };

  return (
    <div className="p-4 rounded-lg border border-border bg-bg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Ingest Schedule</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft">
            {local.is_enabled ? (
              <span className="text-emerald-400">● Enabled — {cronToHuman(local.cron_expression)}</span>
            ) : (
              <span className="text-ink-soft">○ Disabled</span>
            )}
          </span>
          <button
            onClick={() => update({ is_enabled: !local.is_enabled })}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              local.is_enabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                local.is_enabled ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-1">Cron Expression (UTC)</label>
          <input
            type="text"
            value={local.cron_expression}
            onChange={(e) => update({ cron_expression: e.target.value })}
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-ink font-mono focus:outline-none focus:border-accent"
            placeholder="30 9 * * *"
          />
          <p className="text-xs text-ink-soft mt-0.5">{cronToHuman(local.cron_expression)}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-1">Role Group</label>
          <select
            value={local.role_group}
            onChange={(e) => update({ role_group: e.target.value })}
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-ink focus:outline-none focus:border-accent"
          >
            <option value="all">All Groups (default)</option>
            <option value="A">A — OSP / Fiber</option>
            <option value="B">B — CAD / Drafting</option>
            <option value="C">C — GIS / Geospatial</option>
            <option value="D">D — Telecom General</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-1">Days of history to scan</label>
          <input
            type="number"
            min={1}
            max={30}
            value={local.days_back}
            onChange={(e) => update({ days_back: parseInt(e.target.value, 10) || 1 })}
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-ink focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={local.dry_run}
              onChange={(e) => update({ dry_run: e.target.checked })}
              className="w-3.5 h-3.5 accent-accent"
            />
            <span className="text-xs text-ink-soft">Dry run (scan only, no POST)</span>
          </label>
        </div>
      </div>

      {dirty && (
        <button
          onClick={() => onSave(local).then(() => setDirty(false))}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? "Saving..." : "Save Schedule"}
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JobCeoPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [roleGroups, setRoleGroups] = useState<RoleGroup[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedRoleGroupIds, setSelectedRoleGroupIds] = useState<Set<string>>(new Set());
  const [customKeywords, setCustomKeywords] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newGroupKeywords, setNewGroupKeywords] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{ processed: number; enriched: number; pendingAfter: number } | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetchers ─────────────────────────────────────────────────────────

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/job-ceo/runs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch { /* ignore poll errors */ }
  }, []);

  const fetchKeywordGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/job-agent/keyword-groups", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setKeywordGroups(Array.isArray(data) ? data : []);
    } catch { }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch("/api/job-ceo/schedule", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSchedule(data);
    } catch { }
  }, []);

  const fetchRoleGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/job-agent/role-library", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRoleGroups(data.groups ?? []);
    } catch { }
  }, []);

  useEffect(() => {
    fetchRuns();
    fetchKeywordGroups();
    fetchRoleGroups();
    fetchSchedule();
    pollRef.current = setInterval(fetchRuns, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchRuns, fetchKeywordGroups, fetchRoleGroups, fetchSchedule]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleTrigger() {
    setTriggering(true);
    setTriggerError(null);
    try {
      // Collect keywords from selected groups + custom input
      const roleKeywords = roleGroups
        .filter((g) => selectedRoleGroupIds.has(g.id))
        .flatMap((g) => g.titles);
      const groupKeywords = keywordGroups
        .filter((g) => selectedGroupIds.has(g.id))
        .flatMap((g) => g.keywords);
      const manualKeywords = customKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const allKeywords = [...new Set([...roleKeywords, ...groupKeywords, ...manualKeywords])];

      const body = allKeywords.length > 0
        ? { scoutTerms: { keywords: allKeywords } }
        : {};

      const res = await fetch("/api/job-ceo/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setTriggerError(data.error ?? "Trigger failed");
      } else {
        await fetchRuns();
      }
    } catch (err: any) {
      setTriggerError(err.message ?? "Trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  async function handleEnrich() {
    setEnriching(true);
    try {
      const res = await fetch("/api/job-ceo/enrich", { method: "POST" });
      if (res.ok) setEnrichResult(await res.json());
    } catch { } finally {
      setEnriching(false);
    }
  }

  async function handleSaveSchedule(patch: Partial<ScheduleRow>) {
    setSavingSchedule(true);
    try {
      const res = await fetch("/api/job-ceo/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setSchedule(data);
      }
    } catch { } finally {
      setSavingSchedule(false);
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      await fetch(`/api/job-agent/keyword-groups/${id}`, { method: "DELETE" });
      setSelectedGroupIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      await fetchKeywordGroups();
    } catch { }
  }

  async function handleCreateGroup() {
    const keywords = newGroupKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    if (!newGroupLabel.trim() || keywords.length === 0) return;
    setSavingGroup(true);
    try {
      const res = await fetch("/api/job-agent/keyword-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newGroupLabel.trim(), keywords }),
      });
      if (res.ok) {
        setNewGroupLabel("");
        setNewGroupKeywords("");
        setShowNewGroup(false);
        await fetchKeywordGroups();
      }
    } catch { } finally {
      setSavingGroup(false);
    }
  }

  // ── Auto-kick ─────────────────────────────────────────────────────────────

  const activeRuns = runs.filter((r) => isLive(r.status));
  const hasActive = activeRuns.length > 0;

  useEffect(() => {
    if (hasActive) {
      fetch("/api/job-ceo/kick", { method: "POST" }).catch(() => {});
    }
  }, [hasActive]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Job CEO</h1>
          <p className="text-sm text-ink-soft mt-1">Multi-agent job ingestion pipeline — OpenJobData + Apify</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/job-ceo/proposals"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors"
          >
            Proposals
          </Link>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            title="Backfill full descriptions for logged jobs with thin/missing text"
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors disabled:opacity-50"
          >
            {enriching ? "Enriching..." : "Enrich Descriptions"}
          </button>
        </div>
      </div>

      {/* Enrich result */}
      {enrichResult && (
        <div className="p-3 rounded-lg border border-border bg-bg flex items-center gap-4 text-sm">
          <span className="text-ink-soft">Description Enricher:</span>
          <span className="text-ink">{enrichResult.enriched} of {enrichResult.processed} enriched this batch</span>
          <span className="text-ink-soft">·</span>
          <span className="text-ink-soft">{enrichResult.pendingAfter} jobs still pending</span>
        </div>
      )}

      {/* Keyword Selector + Trigger */}
      <div className="p-4 rounded-lg border border-border bg-bg space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Role Groups (Default)</h2>
        </div>

        {roleGroups.length === 0 ? (
          <p className="text-xs text-ink-soft">No role groups found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {roleGroups.map((g) => (
              <label 
                key={g.id} 
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm cursor-pointer transition-all select-none ${
                  selectedRoleGroupIds.has(g.id) 
                    ? "bg-accent/10 border-accent text-accent shadow-sm" 
                    : "bg-surface border-border text-ink hover:border-ink-soft hover:bg-surface/80"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedRoleGroupIds.has(g.id)}
                  onChange={(e) => {
                    const next = new Set(selectedRoleGroupIds);
                    e.target.checked ? next.add(g.id) : next.delete(g.id);
                    setSelectedRoleGroupIds(next);
                  }}
                  className="mt-0.5 rounded border-border text-accent focus:ring-0 cursor-pointer w-4 h-4"
                />
                <div className="flex flex-col leading-snug">
                  <span className="font-semibold">{g.id}</span>
                  <span className={`text-xs mt-1 ${selectedRoleGroupIds.has(g.id) ? "text-accent/90" : "text-ink-soft"}`}>
                    {g.label}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <h2 className="text-sm font-semibold text-ink">Custom Keyword Groups</h2>
          <button
            onClick={() => setShowNewGroup((v) => !v)}
            className="text-xs text-accent hover:opacity-80"
          >
            {showNewGroup ? "Cancel" : "+ New Group"}
          </button>
        </div>

        {keywordGroups.length === 0 ? (
          <p className="text-xs text-ink-soft">No keyword groups yet. Create one to filter the ingest by specific roles.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {keywordGroups.map((g) => (
              <label key={g.id} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border rounded text-xs">
                <input
                  type="checkbox"
                  checked={selectedGroupIds.has(g.id)}
                  onChange={(e) => {
                    const next = new Set(selectedGroupIds);
                    e.target.checked ? next.add(g.id) : next.delete(g.id);
                    setSelectedGroupIds(next);
                  }}
                  className="rounded border-border text-accent focus:ring-0"
                />
                <span className="text-ink">{g.label}</span>
                <button onClick={() => handleDeleteGroup(g.id)} className="ml-1 text-ink-soft hover:text-red-500">×</button>
              </label>
            ))}
          </div>
        )}

        {/* Group details panel when selected */}
        {selectedGroupIds.size > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {keywordGroups
              .filter((g) => selectedGroupIds.has(g.id))
              .flatMap((g) => g.keywords)
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((kw) => (
                <span key={kw} className="text-xs px-2 py-0.5 bg-accent/10 text-accent rounded-full">{kw}</span>
              ))
            }
          </div>
        )}

        {/* New group form */}
        {showNewGroup && (
          <div className="p-3 rounded-lg border border-border bg-surface space-y-2">
            <input
              type="text"
              placeholder="Group label (e.g. OSP / Fiber)"
              value={newGroupLabel}
              onChange={(e) => setNewGroupLabel(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-ink focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Keywords (comma-separated): fiber optic, osp, outside plant"
              value={newGroupKeywords}
              onChange={(e) => setNewGroupKeywords(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-ink focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleCreateGroup}
              disabled={savingGroup || !newGroupLabel.trim() || !newGroupKeywords.trim()}
              className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {savingGroup ? "Creating..." : "Create Group"}
            </button>
          </div>
        )}

        {/* Custom keywords */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-1">
            Or type custom keywords manually (comma-separated)
          </label>
          <input
            type="text"
            placeholder="e.g. splice technician, FTTH, aerial fiber"
            value={customKeywords}
            onChange={(e) => setCustomKeywords(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-ink focus:outline-none focus:border-accent"
          />
        </div>

        {/* Trigger button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="px-5 py-2 text-sm font-semibold rounded-md bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {triggering ? "Triggering..." : "▶ Trigger Run Now"}
          </button>
          {selectedRoleGroupIds.size > 0 && (
            <span className="text-xs text-ink-soft">
              Using {selectedRoleGroupIds.size} role group{selectedRoleGroupIds.size !== 1 ? "s" : ""}
            </span>
          )}
          {selectedGroupIds.size > 0 && (
            <span className="text-xs text-ink-soft">
              Using {selectedGroupIds.size} custom group{selectedGroupIds.size !== 1 ? "s" : ""}
            </span>
          )}
          {customKeywords && (
            <span className="text-xs text-ink-soft">+ custom keywords</span>
          )}
        </div>
        {triggerError && (
          <p className="text-xs text-red-400 mt-1">⚠ {triggerError}</p>
        )}
      </div>

      {/* Schedule Control */}
      {schedule && (
        <ScheduleCard
          schedule={schedule}
          onSave={handleSaveSchedule}
          saving={savingSchedule}
        />
      )}

      {/* Active Runs */}
      {hasActive && (
        <div>
          <h2 className="text-lg font-semibold text-ink mb-3">Active Runs</h2>
          {activeRuns.map((run) => (
            <div key={run.id} className="p-4 rounded-lg border border-border bg-bg mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="pipeline-live-dot pipeline-live-dot-running" />
                  <Link
                    href={`/job-ceo/runs/${run.id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {run.id.slice(0, 8)}
                  </Link>
                  {statusBadge(run.status)}
                </div>
                <Link
                  href={`/job-ceo/runs/${run.id}`}
                  className="text-xs text-ink-soft hover:text-ink transition-colors"
                >
                  View pipeline →
                </Link>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {[
                  { label: "Ingested", val: run.ingested_count },
                  { label: "Kept", val: run.kept_count },
                  { label: "Researched", val: run.researched_count },
                  { label: "Matched", val: run.matched_count },
                  { label: "Logged", val: run.logged_count },
                  { label: "Skipped (Dup)", val: run.skipped_count ?? 0 },
                ].map(({ label, val }) => (
                  <div key={label} className="text-center p-2 rounded bg-surface border border-border">
                    <div className={`text-lg font-bold ${label === "Skipped (Dup)" ? "text-amber-400" : "text-ink"}`}>{val}</div>
                    <div className="text-xs text-ink-soft">{label}</div>
                  </div>
                ))}
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

      {/* Run History */}
      <div>
        <h2 className="text-lg font-semibold text-ink mb-3">Run History</h2>
        <div className="table-shell overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-ink-soft p-2">Run ID</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Status</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Source</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Ingested</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Kept</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Researched</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Matched</th>
                <th className="text-right text-xs font-medium text-ink-soft p-2">Logged</th>
                <th className="text-right text-xs font-medium text-amber-500 p-2">Skipped (Dup)</th>
                <th className="text-left text-xs font-medium text-ink-soft p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-sm text-ink-soft py-8">
                    No runs yet. Trigger a run or wait for the daily scheduled ingest.
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border/50 hover:bg-surface/50">
                  <td className="font-mono text-xs p-2">
                    <Link href={`/job-ceo/runs/${run.id}`} className="text-accent hover:underline">
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-2">{statusBadge(run.status)}</td>
                  <td className="text-xs text-ink-soft p-2">{run.source ?? "—"}</td>
                  <td className="text-right text-xs text-ink p-2">{run.ingested_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.kept_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.researched_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.matched_count}</td>
                  <td className="text-right text-xs text-ink p-2">{run.logged_count}</td>
                  <td className="text-right text-xs text-amber-400 font-medium p-2">{run.skipped_count ?? 0}</td>
                  <td className="text-xs text-ink-soft p-2">
                    {new Date(run.created_at).toLocaleDateString()}{" "}
                    {new Date(run.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Keyword Groups Manager */}
      {keywordGroups.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-ink mb-3">Keyword Groups</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {keywordGroups.map((g) => (
              <div key={g.id} className="p-3 rounded-lg border border-border bg-bg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-ink">{g.label}</span>
                  <button
                    onClick={() => handleDeleteGroup(g.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.keywords.map((kw) => (
                    <span key={kw} className="text-xs px-1.5 py-0.5 bg-surface border border-border rounded text-ink-soft">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
