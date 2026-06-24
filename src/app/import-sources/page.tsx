"use client";

import { useEffect, useState } from "react";
import { TableSkeleton } from "../Skeleton";

interface ImportSource {
  id: string;
  label: string;
  provider: string;
  token_or_url: string;
  is_active: boolean;
  last_run_at: string | null;
  last_result: { imported?: number; skipped?: number; error?: string } | null;
  created_at: string;
}

interface ImportRun {
  id: string;
  imported: number | null;
  skipped: number | null;
  error: string | null;
  ran_at: string;
  import_sources: { label: string; provider: string } | null;
}

const providers = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "usajobs", label: "USAJobs" },
  { value: "career_page", label: "Career page" },
];

function providerLabel(value: string) {
  return providers.find((provider) => provider.value === value)?.label ?? value;
}

export default function ImportSourcesPage() {
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState("");
  const [runningAll, setRunningAll] = useState(false);
  const [runSummary, setRunSummary] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    label: "",
    provider: "greenhouse",
    token_or_url: "",
  });

  async function load() {
    setLoading(true);
    const [sourcesRes, runsRes] = await Promise.all([
      fetch("/api/import-sources"),
      fetch("/api/import-runs?limit=25"),
    ]);
    if (!sourcesRes.ok) {
      const data = await sourcesRes.json().catch(() => ({}));
      setError(data.error || "Could not load import sources.");
      setLoading(false);
      return;
    }
    setSources(await sourcesRes.json());
    if (runsRes.ok) setRuns(await runsRes.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createSource() {
    setError("");
    const res = await fetch("/api/import-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save source.");
      return;
    }
    setForm({ label: "", provider: "greenhouse", token_or_url: "" });
    load();
  }

  async function updateSource(source: ImportSource, patch: Partial<ImportSource>) {
    setError("");
    const res = await fetch(`/api/import-sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update source.");
      return;
    }
    const updated = await res.json();
    setSources((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function runSource(source: ImportSource) {
    setRunningId(source.id);
    setError("");
    setRunSummary("");
    const res = await fetch(`/api/import-sources/${source.id}/run`, { method: "POST" });
    setRunningId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Import failed.");
    }
    load();
  }

  async function runAllActive() {
    setRunningAll(true);
    setError("");
    setRunSummary("");
    const res = await fetch("/api/import-sources/run-all", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setRunningAll(false);
    if (!res.ok) {
      setError(data.error || "Import run failed.");
      return;
    }
    setRunSummary(`Ran ${data.ran ?? 0} active source(s): ${data.imported ?? 0} imported, ${data.skipped ?? 0} skipped, ${data.failed ?? 0} failed.`);
    load();
  }

  async function deleteSource(source: ImportSource) {
    if (!confirm(`Delete import source "${source.label}"?`)) return;
    await fetch(`/api/import-sources/${source.id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="page-header">
        <h1>Import Sources</h1>
        <button className="btn-primary" onClick={runAllActive} disabled={runningAll || sources.filter((source) => source.is_active).length === 0}>
          {runningAll ? "Running..." : "Run all active"}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {runSummary && <p style={{ color: "var(--accent)", fontSize: 13 }}>{runSummary}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Add scheduled source</h2>
        <div className="team-create-grid">
          <div className="field-group">
            <label>Label</label>
            <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Acme Greenhouse" />
          </div>
          <div className="field-group">
            <label>Provider</label>
            <select value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}>
              {providers.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
            </select>
          </div>
          <div className="field-group" style={{ gridColumn: "span 2" }}>
            <label>{form.provider === "career_page" ? "Career page URL" : form.provider === "usajobs" ? "Search keyword" : "Board token / slug"}</label>
            <input value={form.token_or_url} onChange={(event) => setForm((current) => ({ ...current, token_or_url: event.target.value }))} placeholder={form.provider === "career_page" ? "https://company.com/careers" : form.provider === "usajobs" ? "civil engineer" : "company-slug"} />
          </div>
        </div>
        <button className="btn-primary" onClick={createSource}>Save source</button>
      </div>

      {loading ? (
        <TableSkeleton cols={6} />
      ) : sources.length === 0 ? (
        <div className="empty">No saved import sources yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Provider</th>
              <th>Token / URL</th>
              <th>Active</th>
              <th>Last run</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td><strong>{source.label}</strong></td>
                <td><span className="badge">{providerLabel(source.provider)}</span></td>
                <td className="muted" style={{ maxWidth: 260, wordBreak: "break-word" }}>{source.token_or_url}</td>
                <td>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={source.is_active} onChange={(event) => updateSource(source, { is_active: event.target.checked })} />
                    Active
                  </label>
                </td>
                <td className="muted">{source.last_run_at ? new Date(source.last_run_at).toLocaleString() : "-"}</td>
                <td>
                  {source.last_result?.error ? (
                    <span className="form-error">{source.last_result.error}</span>
                  ) : source.last_result ? (
                    <span>{source.last_result.imported ?? 0} imported, {source.last_result.skipped ?? 0} skipped</span>
                  ) : <span className="muted">-</span>}
                </td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => runSource(source)} disabled={runningId === source.id}>
                    {runningId === source.id ? "Running..." : "Run now"}
                  </button>
                  <button className="btn-danger" onClick={() => deleteSource(source)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="section-title">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No import runs recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Provider</th>
                <th>Ran</th>
                <th>Imported</th>
                <th>Skipped</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.import_sources?.label ?? "Deleted source"}</td>
                  <td><span className="badge">{providerLabel(run.import_sources?.provider ?? "")}</span></td>
                  <td className="muted">{new Date(run.ran_at).toLocaleString()}</td>
                  <td>{run.imported ?? 0}</td>
                  <td>{run.skipped ?? 0}</td>
                  <td>
                    {run.error ? <span className="form-error">{run.error}</span> : <span style={{ color: "var(--accent)" }}>OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
