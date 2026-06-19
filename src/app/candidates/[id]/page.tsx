// src/app/candidates/[id]/page.tsx
"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface BaseResumeSummary {
  id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Application {
  id: string;
  status: string;
  applied_at: string;
  resume_filename: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  source_type: string | null;
  adhoc_job_data: unknown | null;
  adhoc_job_raw_text: string | null;
  jobs: { id: string; title: string; company: string; location: string; role_tier: string | null } | null;
}

interface Resume {
  id: string;
  label: string;
  kind: string;
  file_url: string;
  filename: string;
  created_at: string;
  parsed_json: any | null;
  is_original_upload: boolean;
}

interface Evidence {
  id: string;
  source_type: string;
  title: string;
  description: string | null;
  related_skills: string[] | null;
  proof_url: string | null;
  confidence_score: number | null;
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
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  visa_status: string | null;
  target_industries: string[] | null;
  location_preference: string | null;
  work_mode_preference: string | null;
  available_start_date: string | null;
  portal_token: string;
  applications: Application[];
  resumes: Resume[];
}

interface ApplicationComment {
  id: string;
  commenter_name: string;
  body: string;
  visible_to_candidate: boolean;
  created_at: string;
}

interface ApplicationEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function CandidateProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [comments, setComments] = useState<ApplicationComment[]>([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [appStatusFilter, setAppStatusFilter] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"Overview" | "Evidence Bank" | "Base Resumes" | "Applications">("Overview");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [parsedReview, setParsedReview] = useState<Resume | null>(null);
  const [acceptingParsed, setAcceptingParsed] = useState(false);
  const [generatingEvidence, setGeneratingEvidence] = useState(false);
  const [baseResumes, setBaseResumes] = useState<BaseResumeSummary[]>([]);
  const [baseResumesLoading, setBaseResumesLoading] = useState(false);
  const [showCreateBaseResume, setShowCreateBaseResume] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/candidates/${id}`);
    setCandidate(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (activeTab === "Evidence Bank" && id) {
      loadEvidence();
    }
    if (activeTab === "Base Resumes" && id) {
      loadBaseResumes();
    }
  }, [activeTab, id]);

  async function loadEvidence() {
    if (!id) return;
    setEvidenceLoading(true);
    const res = await fetch(`/api/candidates/${id}/evidence`);
    setEvidence(res.ok ? await res.json() : []);
    setEvidenceLoading(false);
  }

  async function loadBaseResumes() {
    if (!id) return;
    setBaseResumesLoading(true);
    const res = await fetch(`/api/base-resumes?candidateId=${id}`);
    setBaseResumes(res.ok ? await res.json() : []);
    setBaseResumesLoading(false);
  }

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/candidates/${id}/resume`, { method: "POST", body: formData });
    const data: Resume = res.ok ? await res.json() : null;
    setUploading(false);
    load();
    if (data?.parsed_json) {
      setParsedReview(data);
    }
  }

  async function acceptParsedData(resume: Resume) {
    if (!candidate) return;
    setAcceptingParsed(true);
    const p = resume.parsed_json;
    const res = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: p.name ?? candidate.name,
        email: p.email ?? candidate.email,
        phone: p.phone ?? candidate.phone,
        linkedin_url: p.linkedin_url ?? candidate.linkedin_url,
        github_url: p.github_url ?? candidate.github_url,
        portfolio_url: p.portfolio_url ?? candidate.portfolio_url,
        location_preference: p.location ?? candidate.location_preference,
      }),
    });
    setAcceptingParsed(false);
    if (res.ok) {
      setParsedReview(null);
      load();
    }
  }

  async function generateEvidenceFromResume(resumeId: string) {
    if (!candidate) return;
    setGeneratingEvidence(true);
    await fetch(`/api/candidates/${candidate.id}/evidence/from-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_id: resumeId }),
    });
    setGeneratingEvidence(false);
    loadEvidence();
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
    const [eventsRes, commentsRes] = await Promise.all([
      fetch(`/api/applications/${applicationId}/events`),
      fetch(`/api/applications/${applicationId}/comments`),
    ]);
    setEvents(await eventsRes.json());
    setComments(commentsRes.ok ? await commentsRes.json() : []);
  }

  async function loadComments(applicationId: string) {
    const res = await fetch(`/api/applications/${applicationId}/comments`);
    if (res.ok) setComments(await res.json());
  }

  function copyPortalLink() {
    const url = `${window.location.origin}/portal/${candidate?.portal_token}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
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

  const primaryResume = candidate.resumes.find((r) => r.is_original_upload) ?? candidate.resumes[0] ?? null;

  return (
    <>
      <div className="page-header">
        <h1>{candidate.name}</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={copyPortalLink}>{linkCopied ? "Copied!" : "Copy candidate portal link"}</button>
          <button onClick={() => setShowEdit(true)}>Edit profile</button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {(["Overview", "Evidence Bank", "Base Resumes", "Applications"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 18px",
              borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
              color: activeTab === tab ? "var(--primary)" : "inherit",
              fontWeight: activeTab === tab ? 600 : 400,
              background: "none",
              borderRadius: 0,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Overview" && (
        <>
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
              <div>
                <label>LinkedIn</label>
                <p>{candidate.linkedin_url ? <a href={candidate.linkedin_url} target="_blank" rel="noreferrer">{candidate.linkedin_url}</a> : "—"}</p>
              </div>
              <div>
                <label>GitHub</label>
                <p>{candidate.github_url ? <a href={candidate.github_url} target="_blank" rel="noreferrer">{candidate.github_url}</a> : "—"}</p>
              </div>
              <div>
                <label>Portfolio</label>
                <p>{candidate.portfolio_url ? <a href={candidate.portfolio_url} target="_blank" rel="noreferrer">{candidate.portfolio_url}</a> : "—"}</p>
              </div>
              <div>
                <label>Visa status</label>
                <p>{candidate.visa_status || "—"}</p>
              </div>
              <div>
                <label>Target industries</label>
                <p>{candidate.target_industries?.length ? candidate.target_industries.join(", ") : "—"}</p>
              </div>
              <div>
                <label>Location preference</label>
                <p>{candidate.location_preference || "—"}</p>
              </div>
              <div>
                <label>Work mode preference</label>
                <p>{candidate.work_mode_preference || "—"}</p>
              </div>
              <div>
                <label>Available start date</label>
                <p>{candidate.available_start_date ? new Date(candidate.available_start_date).toLocaleDateString() : "—"}</p>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Primary resume</label>
              {primaryResume ? (
                <p>
                  <a href={primaryResume.file_url} target="_blank" rel="noreferrer">{primaryResume.filename}</a>
                </p>
              ) : (
                <p className="muted">No resume uploaded yet.</p>
              )}
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleResumeUpload} disabled={uploading} />
              {uploading && <p className="muted">Uploading…</p>}

              {primaryResume?.parsed_json && (
                <div className="card" style={{ marginTop: 12, background: "var(--bg)" }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Parsed Results</h3>
                  <ParsedResults parsed={primaryResume.parsed_json} />
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button onClick={() => acceptParsedData(primaryResume)} disabled={acceptingParsed}>
                      {acceptingParsed ? "Accepting…" : "Accept parsed data into profile"}
                    </button>
                    <button onClick={() => generateEvidenceFromResume(primaryResume.id)} disabled={generatingEvidence}>
                      {generatingEvidence ? "Generating…" : "Generate evidence from resume"}
                    </button>
                  </div>
                </div>
              )}
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
        </>
      )}

      {activeTab === "Evidence Bank" && (
        <div>
          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Evidence Bank ({evidence.length})</h2>
            <button onClick={() => setShowAddEvidence(true)}>+ Add evidence</button>
          </div>

          {evidenceLoading ? (
            <p className="muted">Loading evidence…</p>
          ) : evidence.length === 0 ? (
            <div className="empty">
              No evidence yet. Upload a resume to auto-generate, or add manually.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {evidence.map((ev) => (
                <div key={ev.id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="badge">{ev.source_type}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{ev.title}</h3>
                  {ev.description && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{ev.description}</p>}
                  {ev.related_skills && ev.related_skills.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {ev.related_skills.map((s) => (
                        <span key={s} className="badge">{s}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Confidence: {ev.confidence_score !== null ? `${Math.round(ev.confidence_score * 100)}%` : "—"}
                    </span>
                    {ev.proof_url && <a href={ev.proof_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Proof</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "Base Resumes" && (
        <div>
          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Base resumes ({baseResumes.length})</h2>
            <button onClick={() => setShowCreateBaseResume(true)}>+ Create base resume</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            Reusable, structured starting points built with the Falood CLI — not job-specific
            exports. Use one of these as the base when tailoring an application later.
          </p>
          {baseResumesLoading ? (
            <p className="muted">Loading…</p>
          ) : baseResumes.length === 0 ? (
            <div className="empty">No base resumes yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Target industry</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {baseResumes.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.name}</strong></td>
                    <td className="muted">{b.target_industry ?? "—"}</td>
                    <td><span className="badge">{b.status}</span></td>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(b.updated_at).toLocaleDateString()}</td>
                    <td><Link className="row-link" href={`/falood/studio/base/${b.id}`}>Open in studio</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "Applications" && (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Applications ({candidate.applications.length})</h2>

          {candidate.applications.length > 0 && (
            <div className="filter-bar">
              <select value={appStatusFilter} onChange={(e) => setAppStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="assigned">Assigned</option>
                <option value="stacked">Stacked</option>
                <option value="in_progress">In progress</option>
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
                      <td>{a.jobs?.title || <span className="muted">Ad-hoc job</span>}</td>
                      <td className="muted">{a.jobs?.company || <span className="muted">—</span>}</td>
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
                          <label style={{ display: "block", marginBottom: 6 }}>Status history</label>
                          {events.length === 0 ? (
                            <span className="muted">No status changes recorded yet.</span>
                          ) : (
                            <ul style={{ margin: "0 0 16px", paddingLeft: 18 }}>
                              {events.map((ev) => (
                                <li key={ev.id} className="muted" style={{ fontSize: 12 }}>
                                  {new Date(ev.created_at).toLocaleString()} — {ev.from_status ?? "(created)"} → <strong>{ev.to_status}</strong>
                                </li>
                              ))}
                            </ul>
                          )}
                          <ApplicationComments
                            applicationId={a.id}
                            comments={comments}
                            onCommented={() => loadComments(a.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            );
          })()}
        </div>
      )}

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
      {showAddEvidence && (
        <AddEvidenceModal
          candidateId={candidate.id}
          onClose={() => setShowAddEvidence(false)}
          onAdded={() => { setShowAddEvidence(false); loadEvidence(); }}
        />
      )}
      {parsedReview && parsedReview.parsed_json && (
        <div className="modal-overlay" onClick={() => setParsedReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Review parsed resume</h2>
            <ParsedResults parsed={parsedReview.parsed_json} />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => acceptParsedData(parsedReview)} disabled={acceptingParsed}>
                {acceptingParsed ? "Accepting…" : "Accept parsed data into profile"}
              </button>
              <button onClick={() => generateEvidenceFromResume(parsedReview.id)} disabled={generatingEvidence}>
                {generatingEvidence ? "Generating…" : "Generate evidence from resume"}
              </button>
              <button onClick={() => setParsedReview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ParsedResults({ parsed }: { parsed: any }) {
  const skills = parsed?.skills ?? [];
  const experience = parsed?.experience ?? [];
  const education = parsed?.education ?? [];
  const certifications = parsed?.certifications ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
      <div><label>Name</label><p className="muted">{parsed?.name || "—"}</p></div>
      <div><label>Email</label><p className="muted">{parsed?.email || "—"}</p></div>
      <div><label>Phone</label><p className="muted">{parsed?.phone || "—"}</p></div>
      <div><label>Location</label><p className="muted">{parsed?.location || "—"}</p></div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Skills</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {skills.length ? skills.map((s: string) => <span key={s} className="badge">{s}</span>) : <span className="muted">—</span>}
        </div>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Experience</label>
        {experience.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {experience.map((exp: any, i: number) => (
              <li key={i} className="muted">{exp.company} — {exp.title}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Education</label>
        {education.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {education.map((edu: any, i: number) => (
              <li key={i} className="muted">{edu.school} — {edu.degree}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Certifications</label>
        {certifications.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {certifications.map((cert: any, i: number) => (
              <li key={i} className="muted">{cert.name || cert}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function ApplicationComments({ applicationId, comments, onCommented }: { applicationId: string; comments: ApplicationComment[]; onCommented: () => void }) {
  const [commenterName, setCommenterName] = useState("");
  const [body, setBody] = useState("");
  const [visibleToCandidate, setVisibleToCandidate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCommenterName(localStorage.getItem("skarion_commenter_name") ?? "");
  }, []);

  async function submit() {
    if (!commenterName.trim()) { setError("Add your name."); return; }
    if (!body.trim()) { setError("Write a log entry first."); return; }

    setSaving(true);
    setError("");
    const res = await fetch(`/api/applications/${applicationId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commenter_name: commenterName, body, visible_to_candidate: visibleToCandidate }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not save log entry.");
      return;
    }

    localStorage.setItem("skarion_commenter_name", commenterName.trim());
    setBody("");
    setVisibleToCandidate(false);
    onCommented();
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <label style={{ display: "block", marginBottom: 6 }}>Activity log</label>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, alignItems: "start", marginBottom: 8 }}>
        <input
          value={commenterName}
          onChange={(e) => setCommenterName(e.target.value)}
          placeholder="Your name"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="e.g. Recruiter called, interview scheduled for Tuesday..."
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: comments.length ? 16 : 0 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={visibleToCandidate} onChange={(e) => setVisibleToCandidate(e.target.checked)} />
          Share with candidate
        </label>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Posting..." : "Add log entry"}
        </button>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      {comments.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>No log entries yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comments.map((comment) => (
            <div key={comment.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <strong>{comment.commenter_name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(comment.created_at).toLocaleString()}
                  {comment.visible_to_candidate && <span className="badge" style={{ marginLeft: 8 }}>visible to candidate</span>}
                </span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>{comment.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditProfileModal({ candidate, onClose, onSaved }: { candidate: CandidateDetail; onClose: () => void; onSaved: () => void }) {
  const [targetRoles, setTargetRoles] = useState(candidate.target_roles ?? "");
  const [preferredLocations, setPreferredLocations] = useState(candidate.preferred_locations ?? "");
  const [salaryExpectation, setSalaryExpectation] = useState(candidate.salary_expectation ?? "");
  const [workAuthorization, setWorkAuthorization] = useState(candidate.work_authorization ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(candidate.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(candidate.github_url ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(candidate.portfolio_url ?? "");
  const [visaStatus, setVisaStatus] = useState(candidate.visa_status ?? "");
  const [targetIndustries, setTargetIndustries] = useState(candidate.target_industries?.join(", ") ?? "");
  const [locationPreference, setLocationPreference] = useState(candidate.location_preference ?? "");
  const [workModePreference, setWorkModePreference] = useState(candidate.work_mode_preference ?? "");
  const [availableStartDate, setAvailableStartDate] = useState(candidate.available_start_date ?? "");
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
        linkedin_url: linkedinUrl || null,
        github_url: githubUrl || null,
        portfolio_url: portfolioUrl || null,
        visa_status: visaStatus || null,
        target_industries: targetIndustries ? targetIndustries.split(",").map((s) => s.trim()).filter(Boolean) : null,
        location_preference: locationPreference || null,
        work_mode_preference: workModePreference || null,
        available_start_date: availableStartDate || null,
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
        <div className="field-group">
          <label>LinkedIn URL</label>
          <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
        </div>
        <div className="field-group">
          <label>GitHub URL</label>
          <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/..." />
        </div>
        <div className="field-group">
          <label>Portfolio URL</label>
          <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field-group">
          <label>Visa status</label>
          <input value={visaStatus} onChange={(e) => setVisaStatus(e.target.value)} placeholder="e.g. H1B, Green Card" />
        </div>
        <div className="field-group">
          <label>Target industries (comma-separated)</label>
          <input value={targetIndustries} onChange={(e) => setTargetIndustries(e.target.value)} placeholder="e.g. Telecom, SaaS, Finance" />
        </div>
        <div className="field-group">
          <label>Location preference</label>
          <input value={locationPreference} onChange={(e) => setLocationPreference(e.target.value)} placeholder="e.g. Remote, NYC" />
        </div>
        <div className="field-group">
          <label>Work mode preference</label>
          <input value={workModePreference} onChange={(e) => setWorkModePreference(e.target.value)} placeholder="e.g. Remote, Hybrid, Onsite" />
        </div>
        <div className="field-group">
          <label>Available start date</label>
          <input type="date" value={availableStartDate} onChange={(e) => setAvailableStartDate(e.target.value)} />
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

function AddEvidenceModal({ candidateId, onClose, onAdded }: { candidateId: string; onClose: () => void; onAdded: () => void }) {
  const [sourceType, setSourceType] = useState("resume");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [relatedSkills, setRelatedSkills] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [confidenceScore, setConfidenceScore] = useState(0.8);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/candidates/${candidateId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: sourceType,
        title: title.trim(),
        description: description.trim() || null,
        related_skills: relatedSkills ? relatedSkills.split(",").map((s) => s.trim()).filter(Boolean) : null,
        proof_url: proofUrl.trim() || null,
        confidence_score: confidenceScore,
      }),
    });
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
        <h2>Add evidence</h2>
        <div className="field-group">
          <label>Source type</label>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            <option value="resume">Resume</option>
            <option value="interview">Interview</option>
            <option value="reference">Reference</option>
            <option value="assessment">Assessment</option>
            <option value="portfolio">Portfolio</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field-group">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Strong React experience" />
        </div>
        <div className="field-group">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Details..." />
        </div>
        <div className="field-group">
          <label>Related skills (comma-separated)</label>
          <input value={relatedSkills} onChange={(e) => setRelatedSkills(e.target.value)} placeholder="e.g. React, TypeScript, Node.js" />
        </div>
        <div className="field-group">
          <label>Proof URL</label>
          <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field-group">
          <label>Confidence score: {Math.round(confidenceScore * 100)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={confidenceScore}
            onChange={(e) => setConfidenceScore(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add evidence"}
          </button>
        </div>
      </div>
    </div>
  );
}
