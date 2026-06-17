// src/app/jobs/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toCsv, downloadCsv } from "@/lib/csv";

interface Applicant {
  candidate_id: string;
  name: string;
  avatar_url: string | null;
  status: string;
}

interface Job {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  role_tier: string | null;
  source: string;
  is_active: boolean;
  employment_type: string | null;
  seniority_level: string | null;
  posted_at: string | null;
  applicant_count: number;
  applicants: Applicant[];
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportAts, setShowImportAts] = useState(false);
  const [showApplyFor, setShowApplyFor] = useState<Job | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("");
  const [postedSort, setPostedSort] = useState<"" | "asc" | "desc">("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/jobs");
    setJobs(await res.json());
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const sources = Array.from(new Set(jobs.map((j) => j.source))).sort();
  const employmentTypes = Array.from(new Set(jobs.map((j) => j.employment_type).filter(Boolean))).sort() as string[];

  const filtered = jobs.filter((j) => {
    if (sourceFilter && j.source !== sourceFilter) return false;
    if (tierFilter && j.role_tier !== tierFilter) return false;
    if (activeFilter && (activeFilter === "active") !== j.is_active) return false;
    if (employmentTypeFilter && j.employment_type !== employmentTypeFilter) return false;
    if (search) {
      const haystack = `${j.title} ${j.company ?? ""} ${j.location ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  if (postedSort) {
    filtered.sort((a, b) => {
      const av = a.posted_at ?? "";
      const bv = b.posted_at ?? "";
      return postedSort === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  function togglePostedSort() {
    setPostedSort((prev) => (prev === "desc" ? "asc" : prev === "asc" ? "" : "desc"));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((j) => j.id))
    );
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this job? This also removes any applications logged against it.")) return;
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected job(s)? This also removes any applications logged against them.`)) return;
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/jobs/${id}`, { method: "DELETE" })));
    load();
  }

  const filtersActive = search || sourceFilter || tierFilter || activeFilter || employmentTypeFilter;

  function exportCsv() {
    const csv = toCsv(filtered, [
      "title", "company", "location", "source", "role_tier", "employment_type",
      "seniority_level", "posted_at", "is_active", "applicant_count",
    ]);
    downloadCsv("jobs.csv", csv);
  }

  return (
    <>
      <div className="page-header">
        <h1>Job masterlist</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowImport(true)}>Import CSV</button>
          <button onClick={() => setShowImportAts(true)}>Import from ATS</button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add job</button>
        </div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search title, company, location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          <option value="osp">OSP</option>
          <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
          <option value="adjacent_2">Adjacent 2 (Telecom)</option>
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
          <option value="">Active + inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        {employmentTypes.length > 0 && (
          <select value={employmentTypeFilter} onChange={(e) => setEmploymentTypeFilter(e.target.value)}>
            <option value="">All employment types</option>
            {employmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {filtersActive && (
          <button onClick={() => { setSearch(""); setSourceFilter(""); setTierFilter(""); setActiveFilter(""); setEmploymentTypeFilter(""); }}>
            Clear filters
          </button>
        )}
        <button onClick={exportCsv}>Export CSV</button>
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {jobs.length}</span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="empty">No jobs yet. Add one manually or import a CSV.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No jobs match these filters.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th>Job</th>
              <th>Company</th>
              <th>Tier</th>
              <th style={{ cursor: "pointer" }} onClick={togglePostedSort}>
                Posted {postedSort === "desc" ? "▼" : postedSort === "asc" ? "▲" : ""}
              </th>
              <th>Applicants</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => (
              <tr key={job.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(job.id)} onChange={() => toggleOne(job.id)} /></td>
                <td>
                  <Link className="row-link" href={`/jobs/${job.id}`}>{job.title}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{job.location}</div>
                </td>
                <td className="muted">{job.company || "—"}</td>
                <td>{job.role_tier ? <span className="badge">{job.role_tier}</span> : <span className="muted">—</span>}</td>
                <td className="muted">{job.posted_at ? new Date(job.posted_at).toLocaleDateString() : "—"}</td>
                <td>
                  <div style={{ marginBottom: 4 }}>
                    <strong>{job.applicant_count}</strong> <span className="muted">applied</span>
                  </div>
                  {job.applicants.length > 0 && (
                    <div>
                      {job.applicants.map((a) => (
                        <span key={a.candidate_id} title={`${a.name} — ${a.status}`}>
                          {a.avatar_url ? (
                            <img className="avatar-circle" src={a.avatar_url} alt={a.name} />
                          ) : (
                            <span className="avatar-circle">{initials(a.name)}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setShowApplyFor(job)}>Log application</button>
                  <button onClick={() => deleteOne(job.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <AddJobModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />
      )}
      {showImport && (
        <ImportCsvModal onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />
      )}
      {showImportAts && (
        <ImportAtsModal onClose={() => setShowImportAts(false)} onImported={() => { setShowImportAts(false); load(); }} />
      )}
      {showApplyFor && (
        <LogApplicationModal
          job={showApplyFor}
          onClose={() => setShowApplyFor(null)}
          onLogged={() => { setShowApplyFor(null); load(); }}
        />
      )}
    </>
  );
}

function AddJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [roleTier, setRoleTier] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) { setError("Job title is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, company, location, role_tier: roleTier || null, source_url: sourceUrl }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onCreated();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add job</h2>
        <div className="field-group">
          <label>Job title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. OSP Designer" />
        </div>
        <div className="field-group">
          <label>Company</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Role tier</label>
          <select value={roleTier} onChange={(e) => setRoleTier(e.target.value)}>
            <option value="">— None —</option>
            <option value="osp">OSP</option>
            <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
            <option value="adjacent_2">Adjacent 2 (Telecom)</option>
          </select>
        </div>
        <div className="field-group">
          <label>Job posting URL</label>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="(optional)" />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add job"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportCsvModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => setRows(results.data as any[]),
      error: (err) => setError(err.message),
    });
  }

  async function submit() {
    if (rows.length === 0) { setError("Parse a CSV first."); return; }
    setImporting(true);
    const res = await fetch("/api/import/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setImporting(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Import failed."); return; }
    setResult(data);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import jobs from CSV</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Expected columns: <code>title</code> (required), <code>company</code>, <code>location</code>,
          <code>role_tier</code>, <code>salary_range</code>, <code>source_url</code>, <code>notes</code>.
        </p>

        <div className="field-group">
          <input type="file" accept=".csv" onChange={handleFile} />
        </div>

        {fileName && !result && (
          <p className="muted">Parsed <strong>{rows.length}</strong> rows from {fileName}.</p>
        )}

        {result && (
          <p style={{ color: "var(--accent)" }}>
            Imported {result.imported} jobs{result.skipped > 0 ? `, skipped ${result.skipped} (missing title)` : ""}.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={submit} disabled={importing || rows.length === 0}>
              {importing ? "Importing…" : `Import ${rows.length || ""} rows`}
            </button>
          )}
          {result && (
            <button className="btn-primary" onClick={onImported}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportAtsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [provider, setProvider] = useState("greenhouse");
  const [token, setToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  async function submit() {
    if (!token.trim()) { setError("Enter the company's board token/slug."); return; }
    setImporting(true);
    setError("");
    const res = await fetch("/api/import/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, token: token.trim() }),
    });
    setImporting(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Import failed."); return; }
    setResult(data);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import from ATS</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Pulls live postings from a company's public job board (no scraping, no auth).
        </p>

        <div className="field-group">
          <label>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
          </select>
        </div>
        <div className="field-group">
          <label>Company board token / slug</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={provider === "greenhouse" ? "e.g. airbnb" : provider === "lever" ? "e.g. netflix" : "e.g. ramp"}
          />
        </div>

        {result && (
          <p style={{ color: "var(--accent)" }}>
            Imported {result.imported} jobs{result.skipped > 0 ? `, skipped ${result.skipped} (already in masterlist)` : ""}.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={submit} disabled={importing}>
              {importing ? "Importing…" : "Import"}
            </button>
          )}
          {result && (
            <button className="btn-primary" onClick={onImported}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogApplicationModal({ job, onClose, onLogged }: { job: Job; onClose: () => void; onLogged: () => void }) {
  const [candidates, setCandidates] = useState<{ id: string; name: string; resume_url: string | null; resume_filename: string | null }[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [status, setStatus] = useState("applied");
  const [resumeVariants, setResumeVariants] = useState<{ id: string; label: string; file_url: string; filename: string }[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/candidates").then((r) => r.json()).then(setCandidates);
  }, []);

  useEffect(() => {
    setResumeId("");
    if (!candidateId) { setResumeVariants([]); return; }
    fetch(`/api/candidates/${candidateId}/resumes`).then((r) => r.json()).then(setResumeVariants);
  }, [candidateId]);

  async function submit() {
    if (!candidateId) { setError("Select a candidate."); return; }
    setSaving(true);
    setError("");
    const candidate = candidates.find((c) => c.id === candidateId);
    const variant = resumeVariants.find((r) => r.id === resumeId);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: candidateId,
        job_id: job.id,
        status,
        resume_id: variant?.id ?? null,
        resume_url: variant?.file_url ?? candidate?.resume_url ?? null,
        resume_filename: variant?.filename ?? candidate?.resume_filename ?? null,
      }),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Something went wrong."); return; }
    onLogged();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Log application — {job.title}</h2>

        <div className="field-group">
          <label>Candidate</label>
          <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
            <option value="">— Select —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.resume_filename ? "" : " (no resume uploaded)"}</option>
            ))}
          </select>
        </div>

        {candidateId && resumeVariants.length > 0 && (
          <div className="field-group">
            <label>Resume version</label>
            <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
              <option value="">Primary resume</option>
              {resumeVariants.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field-group">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="applied">Applied</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
            <option value="offer">Offer</option>
          </select>
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Log application"}
          </button>
        </div>
      </div>
    </div>
  );
}
