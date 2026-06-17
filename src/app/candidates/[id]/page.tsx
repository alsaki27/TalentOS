// src/app/candidates/[id]/page.tsx
"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Application {
  id: string;
  status: string;
  applied_at: string;
  resume_filename: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  jobs: { id: string; title: string; company: string; location: string; role_tier: string | null };
}

interface Resume {
  id: string;
  label: string;
  kind: string;
  file_url: string;
  filename: string;
  created_at: string;
}

interface CandidateDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  target_tier: string | null;
  notes: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  avatar_url: string | null;
  target_roles: string | null;
  preferred_locations: string | null;
  salary_expectation: string | null;
  work_authorization: string | null;
  applications: Application[];
  resumes: Resume[];
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

interface ApplicationEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [appStatusFilter, setAppStatusFilter] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/candidates/${id}`);
    setCandidate(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`/api/candidates/${id}/resume`, { method: "POST", body: formData });
    setUploading(false);
    load();
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`/api/candidates/${id}/photo`, { method: "POST", body: formData });
    setUploadingPhoto(false);
    load();
  }

  async function deleteVariant(resumeId: string) {
    await fetch(`/api/candidates/${id}/resumes/${resumeId}`, { method: "DELETE" });
    load();
  }

  async function updateFollowUp(applicationId: string, value: string) {
    await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_at: value || null }),
    });
    load();
  }

  async function toggleHistory(applicationId: string) {
    if (expandedAppId === applicationId) {
      setExpandedAppId(null);
      return;
    }
    setExpandedAppId(applicationId);
    const res = await fetch(`/api/applications/${applicationId}/events`);
    setEvents(await res.json());
  }

  function toggleAppSelected(id: string) {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteApplication(id: string) {
    if (!confirm("Delete this application? This also removes its status history.")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteSelectedApplications() {
    if (!confirm(`Delete ${selectedApps.size} selected application(s)?`)) return;
    await Promise.all(Array.from(selectedApps).map((id) => fetch(`/api/applications/${id}`, { method: "DELETE" })));
    setSelectedApps(new Set());
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (!candidate) return <p className="muted">Candidate not found.</p>;

  return (
    <>
      <div className="page-header">
        <h1>{candidate.name}</h1>
        <button onClick={() => setShowEdit(true)}>Edit profile</button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          {candidate.avatar_url ? (
            <img className="avatar-circle" style={{ width: 56, height: 56, fontSize: 18 }} src={candidate.avatar_url} alt={candidate.name} />
          ) : (
            <span className="avatar-circle" style={{ width: 56, height: 56, fontSize: 18 }}>{initials(candidate.name)}</span>
          )}
          <div>
            <label>Profile picture</label>
            <input type="file" accept="image/*" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
            {uploadingPhoto && <span className="muted" style={{ fontSize: 12 }}> Uploading…</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label>Email</label>
            <p>{candidate.email || "—"}</p>
          </div>
          <div>
            <label>Phone</label>
            <p>{candidate.phone || "—"}</p>
          </div>
          <div>
            <label>Status</label>
            <p>{candidate.status}</p>
          </div>
          <div>
            <label>Target tier</label>
            <p>{candidate.target_tier ? <span className="badge">{candidate.target_tier}</span> : "—"}</p>
          </div>
          <div>
            <label>Target roles</label>
            <p>{candidate.target_roles || "—"}</p>
          </div>
          <div>
            <label>Preferred locations</label>
            <p>{candidate.preferred_locations || "—"}</p>
          </div>
          <div>
            <label>Salary expectation</label>
            <p>{candidate.salary_expectation || "—"}</p>
          </div>
          <div>
            <label>Work authorization</label>
            <p>{candidate.work_authorization || "—"}</p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label>Primary resume</label>
          {candidate.resume_filename ? (
            <p>
              <a href={candidate.resume_url ?? "#"} target="_blank" rel="noreferrer">{candidate.resume_filename}</a>
            </p>
          ) : (
            <p className="muted">No resume uploaded yet.</p>
          )}
          <input type="file" accept=".pdf,.doc,.docx" onChange={handleResumeUpload} disabled={uploading} />
          {uploading && <p className="muted">Uploading…</p>}
        </div>
      </div>

      <div className="page-header">
        <h2 style={{ fontSize: 16, margin: 0 }}>Resume variants ({candidate.resumes.length})</h2>
        <button onClick={() => setShowAddVariant(true)}>+ Add variant</button>
      </div>

      {candidate.resumes.length === 0 ? (
        <div className="empty" style={{ marginBottom: 20 }}>
          No tailored resumes or cover letters yet.
        </div>
      ) : (
        <table className="table" style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Kind</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {candidate.resumes.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.label}</strong></td>
                <td><span className="badge">{r.kind}</span></td>
                <td><a href={r.file_url} target="_blank" rel="noreferrer">{r.filename}</a></td>
                <td><button onClick={() => deleteVariant(r.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Applications ({candidate.applications.length})</h2>

      {candidate.applications.length > 0 && (
        <div className="filter-bar">
          <select value={appStatusFilter} onChange={(e) => setAppStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="applied">Applied</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
            <option value="offer">Offer</option>
          </select>
        </div>
      )}

      {selectedApps.size > 0 && (
        <div className="bulk-bar">
          <span>{selectedApps.size} selected</span>
          <button className="btn-danger" onClick={deleteSelectedApplications}>Delete selected</button>
        </div>
      )}

      {candidate.applications.length === 0 ? (
        <div className="empty">No applications logged yet for this candidate.</div>
      ) : (() => {
        const filteredApps = candidate.applications.filter((a) => !appStatusFilter || a.status === appStatusFilter);
        return filteredApps.length === 0 ? (
          <div className="empty">No applications match this filter.</div>
        ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={selectedApps.size === filteredApps.length}
                  onChange={() =>
                    setSelectedApps((prev) =>
                      prev.size === filteredApps.length ? new Set() : new Set(filteredApps.map((a) => a.id))
                    )
                  }
                />
              </th>
              <th>Job</th>
              <th>Company</th>
              <th>Status</th>
              <th>Applied</th>
              <th>Resume used</th>
              <th>Follow-up</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredApps.map((a) => (
              <Fragment key={a.id}>
                <tr>
                  <td><input type="checkbox" style={{ width: "auto" }} checked={selectedApps.has(a.id)} onChange={() => toggleAppSelected(a.id)} /></td>
                  <td>{a.jobs?.title}</td>
                  <td className="muted">{a.jobs?.company}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="muted">{new Date(a.applied_at).toLocaleDateString()}</td>
                  <td className="muted">{a.resume_filename || "—"}</td>
                  <td>
                    <input
                      type="date"
                      defaultValue={a.follow_up_at ?? ""}
                      onBlur={(e) => updateFollowUp(a.id, e.target.value)}
                    />
                  </td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => toggleHistory(a.id)}>History</button>
                    <button onClick={() => deleteApplication(a.id)}>Delete</button>
                  </td>
                </tr>
                {expandedAppId === a.id && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--bg)" }}>
                      {events.length === 0 ? (
                        <span className="muted">No status changes recorded yet.</span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {events.map((ev) => (
                            <li key={ev.id} className="muted" style={{ fontSize: 12 }}>
                              {new Date(ev.created_at).toLocaleString()} — {ev.from_status ?? "(created)"} → <strong>{ev.to_status}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        );
      })()}

      {showEdit && (
        <EditProfileModal
          candidate={candidate}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
      {showAddVariant && (
        <AddVariantModal
          candidateId={candidate.id}
          onClose={() => setShowAddVariant(false)}
          onAdded={() => { setShowAddVariant(false); load(); }}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function EditProfileModal({ candidate, onClose, onSaved }: { candidate: CandidateDetail; onClose: () => void; onSaved: () => void }) {
  const [targetRoles, setTargetRoles] = useState(candidate.target_roles ?? "");
  const [preferredLocations, setPreferredLocations] = useState(candidate.preferred_locations ?? "");
  const [salaryExpectation, setSalaryExpectation] = useState(candidate.salary_expectation ?? "");
  const [workAuthorization, setWorkAuthorization] = useState(candidate.work_authorization ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_roles: targetRoles || null,
        preferred_locations: preferredLocations || null,
        salary_expectation: salaryExpectation || null,
        work_authorization: workAuthorization || null,
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
        <h2>Edit profile</h2>
        <div className="field-group">
          <label>Target roles</label>
          <input value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="e.g. OSP Designer, Telecom PM" />
        </div>
        <div className="field-group">
          <label>Preferred locations</label>
          <input value={preferredLocations} onChange={(e) => setPreferredLocations(e.target.value)} placeholder="e.g. Remote, Atlanta GA" />
        </div>
        <div className="field-group">
          <label>Salary expectation</label>
          <input value={salaryExpectation} onChange={(e) => setSalaryExpectation(e.target.value)} placeholder="e.g. $90k-$110k" />
        </div>
        <div className="field-group">
          <label>Work authorization</label>
          <input value={workAuthorization} onChange={(e) => setWorkAuthorization(e.target.value)} placeholder="e.g. US Citizen, H1B" />
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

function AddVariantModal({ candidateId, onClose, onAdded }: { candidateId: string; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("resume");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!label.trim()) { setError("Label is required."); return; }
    if (!file) { setError("Choose a file."); return; }
    setSaving(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", label);
    formData.append("kind", kind);
    const res = await fetch(`/api/candidates/${candidateId}/resumes`, { method: "POST", body: formData });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onAdded();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add resume variant</h2>
        <div className="field-group">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. OSP-tailored resume" />
        </div>
        <div className="field-group">
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="resume">Resume</option>
            <option value="cover_letter">Cover letter</option>
          </select>
        </div>
        <div className="field-group">
          <label>File</label>
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Uploading…" : "Add variant"}
          </button>
        </div>
      </div>
    </div>
  );
}
