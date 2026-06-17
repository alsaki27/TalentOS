// src/app/jobs/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Applicant {
  application_id: string;
  candidate_id: string;
  name: string;
  status: string;
}

interface JobDetail {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source: string;
  role_tier: string | null;
  salary_range: string | null;
  source_url: string | null;
  notes: string | null;
  is_active: boolean;
  seniority_level: string | null;
  employment_type: string | null;
  applicants_count: number | null;
  company_employees_count: number | null;
  company_website: string | null;
  posted_at: string | null;
  last_seen_at: string | null;
  applicants: Applicant[];
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/jobs/${id}`);
    setJob(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!job) return <p className="muted">Job not found.</p>;

  return (
    <>
      <div className="page-header">
        <h1>{job.title}</h1>
        <button onClick={() => setShowEdit(true)}>Edit job</button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Company" value={job.company} />
          <Field label="Location" value={job.location} />
          <Field label="Source" value={<span className="badge">{job.source}</span>} />
          <Field label="Role tier" value={job.role_tier ? <span className="badge">{job.role_tier}</span> : null} />
          <Field label="Salary range" value={job.salary_range} />
          <Field label="Seniority level" value={job.seniority_level} />
          <Field label="Employment type" value={job.employment_type} />
          <Field label="Applicants (per source)" value={job.applicants_count?.toString() ?? null} />
          <Field label="Company size" value={job.company_employees_count ? `${job.company_employees_count} employees` : null} />
          <Field label="Company website" value={job.company_website ? <a href={job.company_website} target="_blank" rel="noreferrer">{job.company_website}</a> : null} />
          <Field label="Posted" value={job.posted_at ? new Date(job.posted_at).toLocaleDateString() : null} />
          <Field label="Last synced" value={job.last_seen_at ? new Date(job.last_seen_at).toLocaleString() : null} />
          <Field label="Status" value={job.is_active ? "Active" : "Inactive"} />
          <Field label="Posting URL" value={job.source_url ? <a href={job.source_url} target="_blank" rel="noreferrer">View original</a> : null} />
        </div>

        {job.notes && (
          <div style={{ marginTop: 16 }}>
            <label>Notes</label>
            <p>{job.notes}</p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Applicants ({job.applicants.length})</h2>

      {job.applicants.length === 0 ? (
        <div className="empty">No one has applied to this job yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {job.applicants.map((a) => (
              <tr key={a.application_id}>
                <td>{a.name}</td>
                <td><span className={`badge badge-${a.status}`}>{a.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showEdit && (
        <EditJobModal job={job} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      <p>{value ?? "—"}</p>
    </div>
  );
}

function EditJobModal({ job, onClose, onSaved }: { job: JobDetail; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: job.title,
    company: job.company ?? "",
    location: job.location ?? "",
    role_tier: job.role_tier ?? "",
    salary_range: job.salary_range ?? "",
    source_url: job.source_url ?? "",
    notes: job.notes ?? "",
    seniority_level: job.seniority_level ?? "",
    employment_type: job.employment_type ?? "",
    company_website: job.company_website ?? "",
    is_active: job.is_active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.title.trim()) { setError("Job title is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        company: form.company || null,
        location: form.location || null,
        role_tier: form.role_tier || null,
        salary_range: form.salary_range || null,
        source_url: form.source_url || null,
        notes: form.notes || null,
        seniority_level: form.seniority_level || null,
        employment_type: form.employment_type || null,
        company_website: form.company_website || null,
        is_active: form.is_active,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit job</h2>

        <div className="field-group">
          <label>Job title</label>
          <input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Company</label>
          <input value={form.company} onChange={(e) => set("company", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Location</label>
          <input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Role tier</label>
          <select value={form.role_tier} onChange={(e) => set("role_tier", e.target.value)}>
            <option value="">— None —</option>
            <option value="osp">OSP</option>
            <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
            <option value="adjacent_2">Adjacent 2 (Telecom)</option>
          </select>
        </div>
        <div className="field-group">
          <label>Salary range</label>
          <input value={form.salary_range} onChange={(e) => set("salary_range", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Seniority level</label>
          <input value={form.seniority_level} onChange={(e) => set("seniority_level", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Employment type</label>
          <input value={form.employment_type} onChange={(e) => set("employment_type", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Company website</label>
          <input value={form.company_website} onChange={(e) => set("company_website", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Posting URL</label>
          <input value={form.source_url} onChange={(e) => set("source_url", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </div>
        <div className="field-group">
          <label>
            <input
              type="checkbox"
              style={{ width: "auto", marginRight: 6 }}
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            Active
          </label>
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
