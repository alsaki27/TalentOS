"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface CompanyJob {
  id: string;
  title: string;
  location: string | null;
  source: string;
  posted_at: string | null;
  is_active: boolean;
  applicants_count: number | null;
  job_category: string | null;
  category_relevance_score: number | null;
}

interface CompanyApplication {
  id: string;
  status: string;
  applied_at: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  assigned_to: string | null;
  assignment_due_at: string | null;
  candidates: { id: string; name: string } | null;
  jobs: { id: string; title: string; company_id: string } | null;
}

interface CompanyApplicationLog {
  id: string;
  kind: "status_event" | "comment";
  application_id: string;
  created_at: string;
  candidate: { id: string; name: string } | null;
  job: { id: string; title: string } | null;
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor: string | null;
  visible_to_candidate: boolean;
}

interface CompanyPerson {
  id: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  influence_level: string;
  relationship_status: string;
  notes: string | null;
  source: string | null;
  last_seen_at: string | null;
}

interface CompanyDetail {
  id: string;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  logo_url: string | null;
  employees_count: number | null;
  slogan: string | null;
  description: string | null;
  notes: string | null;
  source: string | null;
  last_seen_at: string | null;
  jobs: CompanyJob[];
  people: CompanyPerson[];
  applications: CompanyApplication[];
  application_logs: CompanyApplicationLog[];
}

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPerson, setEditingPerson] = useState<CompanyPerson | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/companies/${id}`);
    if (res.ok) setCompany(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="loading-panel">Loading company...</div>;
  if (!company) return <div className="empty">Company not found.</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{company.name}</h1>
          <div className="page-kicker">{company.slogan || "Company profile and relationship intelligence."}</div>
        </div>
        <button onClick={() => setEditingCompany(true)}>Edit company</button>
      </div>

      <div className="stats-strip">
        <div className="stat-card"><span className="stat-label">Past jobs</span><span className="stat-value">{company.jobs.length}</span></div>
        <div className="stat-card"><span className="stat-label">People</span><span className="stat-value">{company.people.length}</span></div>
        <div className="stat-card"><span className="stat-label">Applications</span><span className="stat-value">{company.applications.length}</span></div>
        <div className="stat-card"><span className="stat-label">Logs</span><span className="stat-value">{company.application_logs.length}</span></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 16, alignItems: "start" }}>
          <div>
            {company.logo_url ? (
              <img src={company.logo_url} alt={`${company.name} logo`} style={{ maxWidth: 96, maxHeight: 96, objectFit: "contain" }} />
            ) : (
              <div className="avatar-circle" style={{ width: 64, height: 64 }}>{company.name.slice(0, 2).toUpperCase()}</div>
            )}
          </div>
          <div>
            <div className="action-group" style={{ marginBottom: 10 }}>
              {company.website && <a href={company.website} target="_blank" rel="noreferrer">Website</a>}
              {company.linkedin_url && <a href={company.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
              {company.source && <span className="badge">{company.source}</span>}
            </div>
            {company.description ? <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{company.description}</p> : <p className="muted">No company description yet.</p>}
            {company.notes && <p><strong>Internal notes:</strong> {company.notes}</p>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Influential people</h2>
          <button onClick={() => setAddingPerson(true)}>Add person</button>
        </div>
        {company.people.length === 0 ? (
          <p className="muted">No people yet. LinkedIn job posters will auto-fill here, and you can add hiring managers manually.</p>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Influence</th>
                  <th>Relationship</th>
                  <th>Contact</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {company.people.map((person) => (
                  <tr key={person.id}>
                    <td className="cell-main">
                      <strong>{person.full_name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{person.title || "-"}</div>
                      {person.source && <span className="badge">{person.source}</span>}
                    </td>
                    <td><span className="badge">{person.influence_level.replaceAll("_", " ")}</span></td>
                    <td><span className="badge">{person.relationship_status.replaceAll("_", " ")}</span></td>
                    <td>
                      <div className="action-group">
                        {person.linkedin_url && <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                        {person.email && <a href={`mailto:${person.email}`}>Email</a>}
                        {person.phone && <span className="muted">{person.phone}</span>}
                      </div>
                    </td>
                    <td className="cell-note">{person.notes || "-"}</td>
                    <td><button className="btn-compact" onClick={() => setEditingPerson(person)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Application log</h2>
        {company.application_logs.length === 0 ? (
          <p className="muted">No application activity has been logged for this company yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {company.application_logs.slice(0, 50).map((log) => (
              <div key={log.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                  <div>
                    <span className="badge">{log.kind === "comment" ? "Comment" : "Status"}</span>{" "}
                    {log.candidate ? <Link className="row-link" href={`/candidates/${log.candidate.id}`}>{log.candidate.name}</Link> : <span className="muted">Unknown candidate</span>}
                    <span className="muted"> on </span>
                    {log.job ? <Link className="row-link" href={`/jobs/${log.job.id}`}>{log.job.title}</Link> : <span className="muted">Unknown job</span>}
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{new Date(log.created_at).toLocaleString()}</span>
                </div>
                {log.kind === "status_event" ? (
                  <p className="muted" style={{ margin: 0 }}>
                    {(log.from_status || "new").replaceAll("_", " ")} {"->"} {(log.to_status || "").replaceAll("_", " ")}
                    {log.body ? `: ${log.body}` : ""}
                  </p>
                ) : (
                  <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>
                    <strong>{log.actor || "Comment"}</strong>: {log.body}
                    {log.visible_to_candidate && <span className="badge" style={{ marginLeft: 8 }}>candidate visible</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Applications at this company</h2>
        {company.applications.length === 0 ? (
          <p className="muted">No candidate applications are linked to this company yet.</p>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Follow-up</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {company.applications.map((application) => (
                  <tr key={application.id}>
                    <td>{application.candidates ? <Link className="row-link" href={`/candidates/${application.candidates.id}`}>{application.candidates.name}</Link> : <span className="muted">-</span>}</td>
                    <td>{application.jobs ? <Link className="row-link" href={`/jobs/${application.jobs.id}`}>{application.jobs.title}</Link> : <span className="muted">-</span>}</td>
                    <td><span className={`badge badge-${application.status}`}>{application.status.replaceAll("_", " ")}</span></td>
                    <td className="muted">{application.follow_up_at ? new Date(application.follow_up_at).toLocaleDateString() : application.next_action || "-"}</td>
                    <td className="muted">{application.assigned_to || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Past jobs</h2>
        {company.jobs.length === 0 ? (
          <p className="muted">No jobs linked yet.</p>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Posted</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {company.jobs.map((job) => (
                  <tr key={job.id}>
                    <td><Link className="row-link" href={`/jobs/${job.id}`}>{job.title}</Link></td>
                    <td>{job.job_category ? <span className="badge">{job.job_category}</span> : <span className="muted">-</span>}</td>
                    <td className="muted">{job.location || "-"}</td>
                    <td className="muted">{job.posted_at ? new Date(job.posted_at).toLocaleDateString() : "-"}</td>
                    <td><span className="badge">{job.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingCompany && (
        <CompanyModal company={company} onClose={() => setEditingCompany(false)} onSaved={() => { setEditingCompany(false); load(); }} />
      )}
      {(addingPerson || editingPerson) && (
        <PersonModal
          companyId={company.id}
          person={editingPerson}
          onClose={() => { setAddingPerson(false); setEditingPerson(null); }}
          onSaved={() => { setAddingPerson(false); setEditingPerson(null); load(); }}
        />
      )}
    </>
  );
}

function CompanyModal({ company, onClose, onSaved }: { company: CompanyDetail; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: company.name,
    website: company.website ?? "",
    linkedin_url: company.linkedin_url ?? "",
    logo_url: company.logo_url ?? "",
    employees_count: company.employees_count?.toString() ?? "",
    slogan: company.slogan ?? "",
    description: company.description ?? "",
    notes: company.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        employees_count: form.employees_count ? parseInt(form.employees_count, 10) : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save company.");
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit company</h2>
        <FieldInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <FieldInput label="Website" value={form.website} onChange={(value) => setForm({ ...form, website: value })} />
        <FieldInput label="LinkedIn URL" value={form.linkedin_url} onChange={(value) => setForm({ ...form, linkedin_url: value })} />
        <FieldInput label="Logo URL" value={form.logo_url} onChange={(value) => setForm({ ...form, logo_url: value })} />
        <FieldInput label="Employees" value={form.employees_count} onChange={(value) => setForm({ ...form, employees_count: value })} />
        <FieldInput label="Slogan" value={form.slogan} onChange={(value) => setForm({ ...form, slogan: value })} />
        <div className="field-group"><label>Description</label><textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="field-group"><label>Internal notes</label><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function PersonModal({ companyId, person, onClose, onSaved }: { companyId: string; person: CompanyPerson | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    full_name: person?.full_name ?? "",
    title: person?.title ?? "",
    linkedin_url: person?.linkedin_url ?? "",
    photo_url: person?.photo_url ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    influence_level: person?.influence_level ?? "unknown",
    relationship_status: person?.relationship_status ?? "new",
    notes: person?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!form.full_name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(person ? `/api/company-people/${person.id}` : `/api/companies/${companyId}/people`, {
      method: person ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save person.");
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!person || !confirm(`Delete ${person.full_name}?`)) return;
    await fetch(`/api/company-people/${person.id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{person ? "Edit person" : "Add person"}</h2>
        <FieldInput label="Name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} />
        <FieldInput label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
        <FieldInput label="LinkedIn URL" value={form.linkedin_url} onChange={(value) => setForm({ ...form, linkedin_url: value })} />
        <FieldInput label="Photo URL" value={form.photo_url} onChange={(value) => setForm({ ...form, photo_url: value })} />
        <FieldInput label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
        <FieldInput label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <div className="field-group">
          <label>Influence level</label>
          <select value={form.influence_level} onChange={(e) => setForm({ ...form, influence_level: e.target.value })}>
            <option value="unknown">Unknown</option>
            <option value="recruiter">Recruiter</option>
            <option value="hiring_manager">Hiring manager</option>
            <option value="manager">Manager</option>
            <option value="executive">Executive</option>
          </select>
        </div>
        <div className="field-group">
          <label>Relationship</label>
          <select value={form.relationship_status} onChange={(e) => setForm({ ...form, relationship_status: e.target.value })}>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="warm">Warm</option>
            <option value="do_not_contact">Do not contact</option>
          </select>
        </div>
        <div className="field-group"><label>Notes</label><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          {person && <button className="btn-danger" onClick={remove}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field-group">
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
