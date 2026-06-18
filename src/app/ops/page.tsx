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

export default function OpsPage() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [digestError, setDigestError] = useState("");

  async function load() {
    setLoading(true);
    const [statusRes, backupsRes, digestsRes] = await Promise.all([
      fetch("/api/ops/status"),
      fetch("/api/ops/backups"),
      fetch("/api/ops/digests"),
    ]);
    if (statusRes.status === 403) { setForbidden(true); setLoading(false); return; }
    setStatus(await statusRes.json());
    setBackups(backupsRes.ok ? await backupsRes.json() : []);
    setDigests(digestsRes.ok ? await digestsRes.json() : []);
    setLoading(false);
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
