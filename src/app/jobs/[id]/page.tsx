// src/app/jobs/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Applicant {
  application_id: string;
  candidate_id: string;
  name: string;
  status: string;
}

interface JobDetail {
  id: string;
  company_id: string | null;
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
  external_job_id: string | null;
  tracking_id: string | null;
  ref_id: string | null;
  apply_url: string | null;
  description_html: string | null;
  description_text: string | null;
  benefits: unknown;
  job_function: string | null;
  industries: string | null;
  input_url: string | null;
  company_linkedin_url: string | null;
  company_logo_url: string | null;
  company_address: unknown;
  company_slogan: string | null;
  company_description: string | null;
  job_poster_name: string | null;
  job_poster_title: string | null;
  job_poster_profile_url: string | null;
  job_poster_photo_url: string | null;
  job_category: string | null;
  category_tags: string[] | null;
  category_relevance_score: number | null;
  category_status: "pending" | "done" | "needs_review" | "failed" | null;
  ai_suggested_category: string | null;
  category_error: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  work_authorization: string | null;
  work_authorization_evidence: string | null;
  last_seen_at: string | null;
  applicants: Applicant[];
  raw_description?: string | null;
  parsed_description?: unknown | null;
  ai_extracted_at?: string | null;
  ai_confidence_score?: number | null;
}

const WORK_AUTH_LABELS: Record<string, string> = {
  us_citizen_required: "US citizen required",
  no_sponsorship: "No sponsorship",
  sponsorship_available: "Sponsorship available",
  unspecified: "Unspecified (posting doesn't say)",
};

interface JobComment {
  id: string;
  job_id: string;
  commenter_name: string;
  body: string;
  created_at: string;
}

interface ShortlistCandidate {
  id: string;
  name: string;
  email: string | null;
  status: string | null;
  target_tier: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  already_on_job: boolean;
  match_score: number;
  match_reasons: string[];
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [comments, setComments] = useState<JobComment[]>([]);
  const [shortlist, setShortlist] = useState<ShortlistCandidate[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/jobs/${id}`);
    setJob(await res.json());
    setLoading(false);
  }

  async function loadComments() {
    if (!id) return;
    const res = await fetch(`/api/jobs/${id}/comments`);
    if (res.ok) setComments(await res.json());
  }

  async function loadShortlist() {
    if (!id) return;
    setShortlistLoading(true);
    const res = await fetch(`/api/jobs/${id}/shortlist`);
    if (res.ok) setShortlist(await res.json());
    setShortlistLoading(false);
  }

  useEffect(() => {
    load();
    loadComments();
  }, [id]);

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
          <Field label="Company" value={job.company_id && job.company ? <Link className="row-link" href={`/companies/${job.company_id}`}>{job.company}</Link> : job.company} />
          <Field label="Location" value={job.location} />
          <Field label="Source" value={<span className="badge">{job.source}</span>} />
          <Field label="Category" value={
            job.category_status === "pending" ? <span className="muted">Categorizing…</span> :
            job.category_status === "needs_review" ? <span className="badge" title={job.ai_suggested_category ? `AI suggested: ${job.ai_suggested_category}` : undefined}>Needs review{job.ai_suggested_category ? ` — suggested: ${job.ai_suggested_category}` : ""}</span> :
            job.category_status === "failed" ? <span className="badge" title={job.category_error ?? undefined}>Failed{job.category_error ? ` — ${job.category_error}` : ""}</span> :
            job.job_category ? <span className="badge">{job.job_category}</span> : null
          } />
          <Field label="Category score" value={job.category_relevance_score !== null && job.category_relevance_score !== undefined ? `${job.category_relevance_score}% relevant` : null} />
          <Field label="Category tags" value={job.category_tags?.length ? job.category_tags.join(", ") : null} />
          <Field label="Role tier" value={job.role_tier ? <span className="badge">{job.role_tier}</span> : null} />
          <Field label="Salary range" value={
            job.salary_min || job.salary_max
              ? `${job.salary_currency ?? ""} ${job.salary_min ?? "?"}–${job.salary_max ?? "?"}${job.salary_period ? `/${job.salary_period}` : ""}`.trim()
              : job.salary_range
          } />
          <Field label="Work authorization" value={
            job.work_authorization && job.work_authorization !== "unspecified"
              ? <span className="badge" title={job.work_authorization_evidence ?? undefined}>{WORK_AUTH_LABELS[job.work_authorization] ?? job.work_authorization}</span>
              : null
          } />
          <Field label="Seniority level" value={job.seniority_level} />
          <Field label="Employment type" value={job.employment_type} />
          <Field label="Job function" value={job.job_function} />
          <Field label="Industries" value={job.industries} />
          <Field label="Applicants (per source)" value={job.applicants_count?.toString() ?? null} />
          <Field label="Company size" value={job.company_employees_count ? `${job.company_employees_count} employees` : null} />
          <Field label="Company website" value={job.company_website ? <a href={job.company_website} target="_blank" rel="noreferrer">{job.company_website}</a> : null} />
          <Field label="Company LinkedIn" value={job.company_linkedin_url ? <a href={job.company_linkedin_url} target="_blank" rel="noreferrer">View company</a> : null} />
          <Field label="Posted" value={job.posted_at ? new Date(job.posted_at).toLocaleDateString() : null} />
          <Field label="Last synced" value={job.last_seen_at ? new Date(job.last_seen_at).toLocaleString() : null} />
          <Field label="Status" value={job.is_active ? "Active" : "Inactive"} />
          <Field label="Posting URL" value={job.source_url ? <a href={job.source_url} target="_blank" rel="noreferrer">View original</a> : null} />
          <Field label="Apply URL" value={job.apply_url ? <a href={job.apply_url} target="_blank" rel="noreferrer">Apply</a> : null} />
          <Field label="External job ID" value={job.external_job_id} />
          <Field label="Tracking/ref" value={[job.tracking_id, job.ref_id].filter(Boolean).join(" / ") || null} />
        </div>

        {Boolean(job.company_logo_url || job.company_slogan || job.company_description || job.company_address) && (
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Company details</h2>
            {job.company_logo_url && (
              <img src={job.company_logo_url} alt={`${job.company ?? "Company"} logo`} style={{ width: 56, height: 56, objectFit: "contain", marginBottom: 12 }} />
            )}
            {job.company_slogan && <p><strong>{job.company_slogan}</strong></p>}
            {job.company_description && <LongText value={job.company_description} />}
            {job.company_address ? <Field label="Company address" value={<JsonValue value={job.company_address} />} /> : null}
          </div>
        )}

        {(job.job_poster_name || job.job_poster_title || job.job_poster_profile_url) && (
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Job poster</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Name" value={job.job_poster_profile_url ? <a href={job.job_poster_profile_url} target="_blank" rel="noreferrer">{job.job_poster_name ?? "View profile"}</a> : job.job_poster_name} />
              <Field label="Title" value={job.job_poster_title} />
            </div>
          </div>
        )}

        {job.description_text && (
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Job description and qualifications</h2>
            <LongText value={job.description_text} />
          </div>
        )}

        {Boolean(job.benefits) ? (
          <div style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Benefits</h2>
            <JsonValue value={job.benefits} />
          </div>
        ) : null}

        {job.notes && (
          <div style={{ marginTop: 16 }}>
            <label>Notes</label>
            <p>{job.notes}</p>
          </div>
        )}
      </div>

      <JobComments comments={comments} jobId={job.id} onCommented={loadComments} />

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Candidate shortlist</h2>
          <button onClick={loadShortlist} disabled={shortlistLoading}>
            {shortlistLoading ? "Scoring..." : "Score candidates"}
          </button>
        </div>
        {shortlist.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Score candidates to see who best fits this job.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Score</th>
                <th>Why</th>
                <th>Resume</th>
              </tr>
            </thead>
            <tbody>
              {shortlist.map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <a className="row-link" href={`/candidates/${candidate.id}`}>{candidate.name}</a>
                    <div className="muted" style={{ fontSize: 12 }}>{candidate.email || candidate.status || "-"}</div>
                    {candidate.already_on_job && <span className="badge badge-review-changes_requested">already on job</span>}
                  </td>
                  <td><strong>{candidate.match_score}%</strong></td>
                  <td className="muted">{candidate.match_reasons.join(", ") || "-"}</td>
                  <td>
                    {candidate.resume_url ? (
                      <a href={candidate.resume_url} target="_blank" rel="noreferrer">{candidate.resume_filename || "Resume"}</a>
                    ) : <span className="muted">Missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function JobComments({ comments, jobId, onCommented }: { comments: JobComment[]; jobId: string; onCommented: () => void }) {
  const [commenterName, setCommenterName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCommenterName(localStorage.getItem("skarion_commenter_name") ?? "");
  }, []);

  async function submit() {
    if (!commenterName.trim()) { setError("Add your name."); return; }
    if (!body.trim()) { setError("Write a comment first."); return; }

    setSaving(true);
    setError("");
    const res = await fetch(`/api/jobs/${jobId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commenter_name: commenterName, body }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not save comment.");
      return;
    }

    localStorage.setItem("skarion_commenter_name", commenterName.trim());
    setBody("");
    onCommented();
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 12 }}>Internal comments</h2>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, alignItems: "start", marginBottom: 12 }}>
        <input
          value={commenterName}
          onChange={(e) => setCommenterName(e.target.value)}
          placeholder="Your name"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add an internal comment..."
        />
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: comments.length ? 16 : 0 }}>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Posting..." : "Post comment"}
        </button>
      </div>

      {comments.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>No internal comments yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((comment) => (
            <div key={comment.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <strong>{comment.commenter_name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{new Date(comment.created_at).toLocaleString()}</span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>{comment.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
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

function LongText({ value }: { value: string }) {
  return <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{value}</p>;
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">-</span>;
  if (typeof value === "string") return <span>{value}</span>;
  return <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>;
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
    apply_url: job.apply_url ?? "",
    description_text: job.description_text ?? "",
    job_function: job.job_function ?? "",
    industries: job.industries ?? "",
    company_linkedin_url: job.company_linkedin_url ?? "",
    company_logo_url: job.company_logo_url ?? "",
    company_slogan: job.company_slogan ?? "",
    company_description: job.company_description ?? "",
    job_category: job.job_category ?? "",
    category_tags: job.category_tags?.join(", ") ?? "",
    category_relevance_score: job.category_relevance_score?.toString() ?? "",
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
        apply_url: form.apply_url || null,
        description_text: form.description_text || null,
        job_function: form.job_function || null,
        industries: form.industries || null,
        company_linkedin_url: form.company_linkedin_url || null,
        company_logo_url: form.company_logo_url || null,
        company_slogan: form.company_slogan || null,
        company_description: form.company_description || null,
        job_category: form.job_category || null,
        category_tags: form.category_tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        category_relevance_score: form.category_relevance_score ? parseInt(form.category_relevance_score, 10) : null,
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
          <label>Category</label>
          <input value={form.job_category} onChange={(e) => set("job_category", e.target.value)} placeholder="e.g. OSP" />
        </div>
        <div className="field-group">
          <label>Category tags</label>
          <input value={form.category_tags} onChange={(e) => set("category_tags", e.target.value)} placeholder="OSP, Drafting, GIS" />
        </div>
        <div className="field-group">
          <label>Category relevance score</label>
          <input value={form.category_relevance_score} onChange={(e) => set("category_relevance_score", e.target.value)} placeholder="0-100" />
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
          <label>Company LinkedIn</label>
          <input value={form.company_linkedin_url} onChange={(e) => set("company_linkedin_url", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Company logo URL</label>
          <input value={form.company_logo_url} onChange={(e) => set("company_logo_url", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Job function</label>
          <input value={form.job_function} onChange={(e) => set("job_function", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Industries</label>
          <input value={form.industries} onChange={(e) => set("industries", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Posting URL</label>
          <input value={form.source_url} onChange={(e) => set("source_url", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Apply URL</label>
          <input value={form.apply_url} onChange={(e) => set("apply_url", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Company slogan</label>
          <input value={form.company_slogan} onChange={(e) => set("company_slogan", e.target.value)} />
        </div>
        <div className="field-group">
          <label>Company description</label>
          <textarea value={form.company_description} onChange={(e) => set("company_description", e.target.value)} rows={4} />
        </div>
        <div className="field-group">
          <label>Job description and qualifications</label>
          <textarea value={form.description_text} onChange={(e) => set("description_text", e.target.value)} rows={8} />
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
