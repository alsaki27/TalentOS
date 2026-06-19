// src/app/ops/page.tsx
// Admin-only system health snapshot — live Supabase reachability, row counts, and
// recent import-run history/errors, all on one page.
"use client";

import { useEffect, useState } from "react";
import { CardSkeleton } from "../Skeleton";
import CrawlerStatusLive from "./CrawlerStatusLive";

interface ImportRun {
  id: string;
  import_source_id: string;
  imported: number | null;
  skipped: number | null;
  error: string | null;
  ran_at: string;
}

interface ImportSource {
  id: string;
  label: string;
  is_active: boolean;
  last_run_at: string | null;
  last_result: { imported?: number; skipped?: number; error?: string } | null;
}

interface OpsStatus {
  supabase: { healthy: boolean; latencyMs: number; error: string | null };
  counts: { candidates: number; jobs: number; applications: number; resumes: number };
  recentImportRuns: ImportRun[];
  importSources: ImportSource[];
  aiAssistant: { configured: boolean; provider: string | null };
}

interface BackupFile {
  name: string;
  createdAt: string | null;
  sizeBytes: number | null;
}

interface Digest {
  id: string;
  content: string;
  provider: string;
  generated_at: string;
}

interface CategorizationRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  jobs_processed: number;
  jobs_failed: number;
  triggered_by: string | null;
  error: string | null;
}

interface NeedsReviewJob {
  id: string;
  title: string;
  company: string | null;
  ai_suggested_category: string | null;
  category_relevance_score: number | null;
}

interface JobCategory {
  id: string;
  label: string;
  description: string | null;
  is_active: boolean;
}

interface CategorizationStatus {
  pendingCount: number;
  needsReview: NeedsReviewJob[];
  recentRuns: CategorizationRun[];
  categories: JobCategory[];
}

export default function OpsPage() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restorePath, setRestorePath] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [digestError, setDigestError] = useState("");
  const [categorization, setCategorization] = useState<CategorizationStatus | null>(null);
  const [processingCategorization, setProcessingCategorization] = useState(false);
  const [categorizationError, setCategorizationError] = useState("");
  const [reviewChoice, setReviewChoice] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const [statusRes, backupsRes, digestsRes, categorizationRes] = await Promise.all([
      fetch("/api/ops/status"),
      fetch("/api/ops/backups"),
      fetch("/api/ops/digests"),
      fetch("/api/ops/categorize"),
    ]);
    if (statusRes.status === 403) { setForbidden(true); setLoading(false); return; }
    setStatus(await statusRes.json());
    setBackups(backupsRes.ok ? await backupsRes.json() : []);
    setDigests(digestsRes.ok ? await digestsRes.json() : []);
    setCategorization(categorizationRes.ok ? await categorizationRes.json() : null);
    setLoading(false);
  }

  async function loadCategorization() {
    const res = await fetch("/api/ops/categorize");
    if (res.ok) setCategorization(await res.json());
  }

  async function processCategorization() {
    setProcessingCategorization(true);
    setCategorizationError("");
    const res = await fetch("/api/ops/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "process" }),
    });
    setProcessingCategorization(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategorizationError(data.error || "Could not process pending jobs.");
      return;
    }
    await loadCategorization();
  }

  async function requeueAllCategorization() {
    if (!confirm("Reset every categorized/needs-review job back to pending? Use this after editing the category list, to re-score everything against it.")) return;
    setCategorizationError("");
    const res = await fetch("/api/ops/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "requeue_all" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategorizationError(data.error || "Could not requeue jobs.");
      return;
    }
    await loadCategorization();
  }

  async function resolveReview(jobId: string, action: "approve_category" | "assign_category", label: string) {
    if (!label.trim()) return;
    setCategorizationError("");
    const res = await fetch("/api/ops/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, jobId, label }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategorizationError(data.error || "Could not update category.");
      return;
    }
    await loadCategorization();
  }

  async function generateDigest() {
    setGeneratingDigest(true);
    setDigestError("");
    const res = await fetch("/api/ops/digests", { method: "POST" });
    setGeneratingDigest(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDigestError(data.error || "Could not generate digest.");
      return;
    }
    const created = await res.json();
    setDigests((prev) => [created, ...prev]);
  }

  async function downloadBackup() {
    setExporting(true);
    const res = await fetch("/api/ops/export");
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "skarion-backup.json";
      a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(false);
  }

  async function restoreBackup() {
    if (!restorePath || restoreConfirm !== "RESTORE TALENTOS BACKUP") return;
    if (!confirm("Restore this backup by upserting candidates, jobs, resumes, and applications? This is not a full point-in-time rollback.")) return;

    setRestoring(true);
    setRestoreMessage(null);
    const res = await fetch("/api/ops/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: restorePath, confirm: restoreConfirm }),
    });
    setRestoring(false);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRestoreMessage({ kind: "error", text: data.error || "Restore failed." });
      return;
    }

    const counts = Object.entries(data.restored ?? {})
      .map(([table, count]) => `${table}: ${count}`)
      .join(", ");
    setRestoreMessage({ kind: "success", text: `Restored ${counts || "0 rows"}.` });
    setRestoreConfirm("");
    await load();
  }

  useEffect(() => { load(); }, []);

  if (forbidden) return <div className="empty">Admins only.</div>;
  if (loading || !status) return <CardSkeleton lines={5} />;

  const sourcesById = new Map(status.importSources.map((s) => [s.id, s.label]));
  const staleSources = status.importSources.filter((s) => s.is_active && s.last_result?.error);

  return (
    <>
      <div className="page-header">
        <h1>System health</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={load}>Refresh</button>
          <button className="btn-primary" onClick={downloadBackup} disabled={exporting}>
            {exporting ? "Exporting..." : "Download backup now"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatusCard
          label="Supabase"
          value={status.supabase.healthy ? "Healthy" : "Down"}
          tone={status.supabase.healthy ? "ok" : "danger"}
        />
        <StatCard label="Latency" value={`${status.supabase.latencyMs}ms`} />
        <StatCard label="Candidates" value={status.counts.candidates} />
        <StatCard label="Jobs" value={status.counts.jobs} />
        <StatCard label="Applications" value={status.counts.applications} />
        <StatusCard
          label="AI assistant"
          value={status.aiAssistant.configured ? `${status.aiAssistant.provider}` : "Not configured"}
          tone={status.aiAssistant.configured ? "ok" : "danger"}
        />
      </div>

      {!status.supabase.healthy && (
        <div className="empty" style={{ color: "var(--danger)", marginBottom: 24 }}>
          {status.supabase.error || "Supabase is unreachable."}
        </div>
      )}

      <CrawlerStatusLive />

      {staleSources.length > 0 && (
        <div className="card" style={{ marginBottom: 24, borderColor: "var(--danger)" }}>
          <label style={{ color: "var(--danger)" }}>Active sources currently failing</label>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {staleSources.map((s) => (
              <li key={s.id}>{s.label}: {s.last_result?.error}</li>
            ))}
          </ul>
        </div>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent import runs</h2>
      {status.recentImportRuns.length === 0 ? (
        <div className="empty">No import runs recorded yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {status.recentImportRuns.map((run) => (
              <tr key={run.id}>
                <td className="muted" style={{ fontSize: 12 }}>{new Date(run.ran_at).toLocaleString()}</td>
                <td>{sourcesById.get(run.import_source_id) ?? run.import_source_id.slice(0, 8)}</td>
                <td>
                  {run.error
                    ? <span style={{ color: "var(--danger)" }}>{run.error}</span>
                    : <span className="muted">{run.imported ?? 0} imported, {run.skipped ?? 0} skipped</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16, margin: "24px 0 12px" }}>Stored backups</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        Daily automated snapshot (candidates/jobs/applications/resumes) via
        <code> /api/cron/backup</code>, stored in the <code>resumes</code> bucket under{" "}
        <code>backups/</code>.
      </p>
      {backups.length === 0 ? (
        <div className="empty">No automated backups yet — the daily cron hasn't run, or `CRON_SECRET` isn't set.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Created</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td className="muted" style={{ fontSize: 12 }}>{b.name}</td>
                <td className="muted" style={{ fontSize: 12 }}>{b.createdAt ? new Date(b.createdAt).toLocaleString() : "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{b.sizeBytes ? `${Math.round(b.sizeBytes / 1024)} KB` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <label>Restore from stored backup</label>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 12px" }}>
          Restore upserts records from a JSON snapshot into candidates, jobs, resumes, and
          applications. It is not a full point-in-time database rollback and does not delete
          records that are absent from the backup.
        </p>
        <div className="filter-bar" style={{ alignItems: "flex-end" }}>
          <div className="field-group" style={{ marginBottom: 0, minWidth: 260 }}>
            <label>Backup file</label>
            <select value={restorePath} onChange={(e) => setRestorePath(e.target.value)}>
              <option value="">Select a backup...</option>
              {backups.map((backup) => (
                <option key={backup.name} value={backup.name}>{backup.name}</option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 0, minWidth: 260 }}>
            <label>Confirmation phrase</label>
            <input
              value={restoreConfirm}
              onChange={(e) => setRestoreConfirm(e.target.value)}
              placeholder="RESTORE TALENTOS BACKUP"
            />
          </div>
          <button
            className="btn-danger"
            onClick={restoreBackup}
            disabled={!restorePath || restoreConfirm !== "RESTORE TALENTOS BACKUP" || restoring}
          >
            {restoring ? "Restoring..." : "Restore backup"}
          </button>
        </div>
        {restoreMessage && (
          <p style={{ color: restoreMessage.kind === "error" ? "var(--danger)" : "var(--accent)", fontSize: 13 }}>
            {restoreMessage.text}
          </p>
        )}
      </div>

      <div className="page-header" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>AI daily digest</h2>
        <button onClick={generateDigest} disabled={generatingDigest || !status.aiAssistant.configured}>
          {generatingDigest ? "Generating..." : "Generate now"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        Single-shot summary (new jobs, overdue tickets, today's applications, pipeline count) —
        no tool-calling, generated automatically once daily via <code>/api/cron/digest</code>.
      </p>
      {digestError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{digestError}</p>}
      {digests.length === 0 ? (
        <div className="empty">No digests generated yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {digests.map((d) => (
            <div key={d.id} className="card">
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                {new Date(d.generated_at).toLocaleString()} · <span className="badge">{d.provider}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.content}</p>
            </div>
          ))}
        </div>
      )}

      <div className="page-header" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Job categorization</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={requeueAllCategorization}>Re-run on all categorized jobs</button>
          <button
            className="btn-primary"
            onClick={processCategorization}
            disabled={processingCategorization || !categorization || categorization.pendingCount === 0}
          >
            {processingCategorization ? "Processing..." : `Process pending now (${categorization?.pendingCount ?? 0})`}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        AI picks the best-fit category, cleans up salary into a structured range, and tags
        work authorization for every job — sequentially, after import, never blocking it.
        Safety net: <code>/api/cron/categorize-jobs</code> drains anything still pending once daily.
      </p>
      {categorizationError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{categorizationError}</p>}

      {categorization && categorization.needsReview.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Needs review ({categorization.needsReview.length})</h3>
          <table className="table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Job</th>
                <th>AI suggested</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {categorization.needsReview.map((job) => (
                <tr key={job.id}>
                  <td>{job.title} {job.company ? <span className="muted">— {job.company}</span> : null}</td>
                  <td className="muted">{job.ai_suggested_category ?? "—"}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {job.ai_suggested_category && (
                      <button onClick={() => resolveReview(job.id, "approve_category", job.ai_suggested_category!)}>
                        Add "{job.ai_suggested_category}" as new category
                      </button>
                    )}
                    <select
                      value={reviewChoice[job.id] ?? ""}
                      onChange={(e) => setReviewChoice((prev) => ({ ...prev, [job.id]: e.target.value }))}
                    >
                      <option value="">Assign existing category…</option>
                      {categorization.categories.filter((c) => c.is_active).map((c) => (
                        <option key={c.id} value={c.label}>{c.label}</option>
                      ))}
                    </select>
                    <button
                      disabled={!reviewChoice[job.id]}
                      onClick={() => resolveReview(job.id, "assign_category", reviewChoice[job.id])}
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {categorization && categorization.recentRuns.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Triggered by</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {categorization.recentRuns.map((run) => (
              <tr key={run.id}>
                <td className="muted" style={{ fontSize: 12 }}>{new Date(run.started_at).toLocaleString()}</td>
                <td className="muted">{run.triggered_by ?? "—"}</td>
                <td>
                  {run.error
                    ? <span style={{ color: "var(--danger)" }}>{run.error}</span>
                    : <span className="muted">{run.jobs_processed} processed, {run.jobs_failed} failed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <label>{label}</label>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{value}</p>
    </div>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: "ok" | "danger" }) {
  return (
    <div className="card">
      <label>{label}</label>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0", color: tone === "danger" ? "var(--danger)" : "var(--accent)" }}>
        {value}
      </p>
    </div>
  );
}
