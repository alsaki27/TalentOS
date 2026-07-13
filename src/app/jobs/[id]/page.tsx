// src/app/jobs/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TailorResumeModal } from "@/components/TailorResumeModal";

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
  const router = useRouter();
  const id = params?.id;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [comments, setComments] = useState<JobComment[]>([]);
  const [shortlist, setShortlist] = useState<ShortlistCandidate[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [tailorContext, setTailorContext] = useState<{ candidateId: string; applicationId?: string } | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  async function addTag() {
    if (!job || !newTagValue.trim()) {
      setAddingTag(false);
      return;
    }
    const tag = newTagValue.trim();
    const currentTags = job.category_tags || [];
    if (currentTags.includes(tag)) {
      setAddingTag(false);
      setNewTagValue("");
      return;
    }
    const updatedTags = [...currentTags, tag];
    setJob({ ...job, category_tags: updatedTags });
    setAddingTag(false);
    setNewTagValue("");
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_tags: updatedTags }),
      });
    } catch (err) {
      console.error(err);
    }
  }
  async function removeTag(tagToRemove: string) {
    if (!job) return;
    const updatedTags = (job.category_tags || []).filter((t) => t !== tagToRemove);
    setJob({ ...job, category_tags: updatedTags });
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_tags: updatedTags }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAnalyze() {
    if (!job) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/analyze`, { method: "POST" });
      if (!res.ok) throw new Error("Analysis failed");
      const updatedJob = await res.json();
      setJob(prev => prev ? { ...prev, ...updatedJob } : null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

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

  const fullText = [job.description_text, job.notes].filter(Boolean).join('\n\n');

  return (
    <>
      <div className="page-header" style={{ flexDirection: "column", alignItems: "flex-start", gap: 16 }}>
        <button onClick={() => { if (window.history.length > 2) { router.back(); } else { router.push('/jobs'); } }} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--ink-soft)", cursor: "pointer", padding: 0, fontSize: "0.9rem", fontWeight: 500 }} onMouseOver={(e) => e.currentTarget.style.color = "var(--ink)"} onMouseOut={(e) => e.currentTarget.style.color = "var(--ink-soft)"}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"></path></svg>
          Back to previous
        </button>
        <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ margin: "0 0 8px 0", fontSize: "1.8rem" }}>{job.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink-soft)", fontSize: "0.95rem" }}>
               {job.company && <span style={{ fontWeight: 600, color: "var(--accent)" }}>{job.company}</span>}
               {job.location && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> {job.location}</span>}
               {job.is_active ? <span className="badge badge-success" style={{ background: "var(--success)", color: "white", padding: "2px 8px" }}>Active</span> : <span className="badge badge-danger">Inactive</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={handleAnalyze} disabled={analyzing} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: "8px", fontWeight: 600, boxShadow: "0 2px 4px rgba(0,0,0,0.1)", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)", cursor: analyzing ? "wait" : "pointer", opacity: analyzing ? 0.7 : 1 }}>
              <span style={{ fontSize: "1.1rem" }}>✨</span>
              {analyzing ? "Analyzing..." : "Analyze with AI"}
            </button>
            <button className="btn-primary" onClick={() => setShowEdit(true)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: "8px", fontWeight: 600, boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
              Edit Job
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <MetricCard icon="💼" label="Employment Type" value={job.employment_type} />
        <MetricCard icon="📈" label="Experience Required" value={job.seniority_level || extractExperience(fullText)} />
        <MetricCard icon="💰" label="Salary" value={job.salary_min || job.salary_max ? `${job.salary_currency ?? ""} ${job.salary_min ?? "?"}–${job.salary_max ?? "?"}${job.salary_period ? `/${job.salary_period}` : ""}`.trim() : job.salary_range} />
        <MetricCard icon="🌐" label="Work Auth" value={(job.work_authorization && job.work_authorization !== "unspecified" ? WORK_AUTH_LABELS[job.work_authorization] ?? job.work_authorization : null) || extractWorkAuth(fullText)} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 32 }}>
        
        {/* Left Column */}
        <div style={{ flex: "1 1 60%", display: "flex", flexDirection: "column", gap: 24, minWidth: 300 }}>
          {Boolean(job.parsed_description) && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
              <h2 style={{ fontSize: "1.25rem", margin: "0 0 16px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "1.4rem" }}>✨</span> AI Job Analysis
              </h2>
              {/* @ts-ignore */}
              {job.parsed_description.job_summary && <p style={{ fontSize: "1.05rem", lineHeight: 1.6, color: "var(--ink)", marginBottom: 20, fontWeight: 500 }}>{job.parsed_description.job_summary}</p>}
              
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* @ts-ignore */}
                {job.parsed_description.required_skills?.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1.1rem", margin: "0 0 8px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: "1.2rem" }}>🎯</span> Required Skills</h3>
                    <ul style={{ margin: 0, paddingLeft: 20, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {/* @ts-ignore */}
                      {job.parsed_description.required_skills.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {/* @ts-ignore */}
                {job.parsed_description.responsibilities?.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1.1rem", margin: "0 0 8px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: "1.2rem" }}>📋</span> Responsibilities</h3>
                    <ul style={{ margin: 0, paddingLeft: 20, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {/* @ts-ignore */}
                      {job.parsed_description.responsibilities.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {/* @ts-ignore */}
                {job.parsed_description.qualifications?.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1.1rem", margin: "0 0 8px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: "1.2rem" }}>🎓</span> Qualifications</h3>
                    <ul style={{ margin: 0, paddingLeft: 20, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {/* @ts-ignore */}
                      {job.parsed_description.qualifications.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
            <h2 style={{ fontSize: "1.25rem", margin: "0 0 20px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.4rem" }}>📄</span> Job Summary & Details
            </h2>
            <SmartDescription text={fullText || "No description provided."} />
          </div>

          {Boolean(job.benefits) && (
             <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
               <h2 style={{ fontSize: "1.25rem", margin: "0 0 16px 0", color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                 <span style={{ fontSize: "1.4rem" }}>🎁</span> Benefits & Perks
               </h2>
               <JsonValue value={job.benefits} />
             </div>
          )}
        </div>

        {/* Right Column */}
        <div style={{ flex: "1 1 30%", display: "flex", flexDirection: "column", gap: 24, minWidth: 300 }}>
          {/* Metadata Card */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
            <h3 style={{ fontSize: "1.1rem", margin: "0 0 16px 0", color: "var(--ink)" }}>Job Details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label="Source" value={<span className="badge" style={{ padding: "4px 8px" }}>{job.source}</span>} />
              <Field label="Category" value={
                job.category_status === "pending" ? <span className="muted">Categorizing…</span> :
                job.category_status === "needs_review" ? <span className="badge" title={job.ai_suggested_category ? `AI suggested: ${job.ai_suggested_category}` : undefined}>Needs review</span> :
                job.category_status === "failed" ? <span className="badge" title={job.category_error ?? undefined}>Failed</span> :
                job.job_category ? <span className="badge">{job.job_category}</span> : null
              } />
              <Field label="Category tags" value={
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(job.category_tags || []).map((tag, idx) => (
                      <span key={idx} className="badge" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {tag}
                        <button
                          onClick={() => removeTag(tag)}
                          style={{ background: "none", border: "none", color: "inherit", padding: 0, margin: 0, fontSize: 10, cursor: "pointer", opacity: 0.7 }}
                          aria-label={`Remove ${tag}`}
                          title={`Remove ${tag}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  {addingTag ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                      <input
                        autoFocus
                        value={newTagValue}
                        onChange={(e) => setNewTagValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addTag();
                          if (e.key === "Escape") setAddingTag(false);
                        }}
                        onBlur={addTag}
                        style={{ padding: "4px 6px", fontSize: 12, width: 110 }}
                        placeholder="Add tag"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAddingTag(true);
                        setNewTagValue("");
                      }}
                      style={{ background: "none", border: "none", color: "var(--accent)", padding: 0, fontSize: 12, cursor: "pointer" }}
                    >
                      + Add tag
                    </button>
                  )}
                </div>
              } />
              <Field label="Role tier" value={job.role_tier ? <span className="badge">{job.role_tier}</span> : null} />
              <Field label="Job function" value={job.job_function} />
              <Field label="Industries" value={job.industries} />
              <Field label="Applicants (per source)" value={job.applicants_count?.toString() ?? null} />
              <Field label="External job ID" value={job.external_job_id} />
              <Field label="Tracking/ref" value={[job.tracking_id, job.ref_id].filter(Boolean).join(" / ") || null} />
              <Field label="Posted" value={job.posted_at ? new Date(job.posted_at).toLocaleDateString() : null} />
              <Field label="Last synced" value={job.last_seen_at ? new Date(job.last_seen_at).toLocaleString() : null} />
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
              {job.source_url && (
                <a href={job.source_url} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", padding: "10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", textDecoration: "none", color: "var(--ink)", fontWeight: 500, transition: "background 0.2s" }} onMouseOver={(e) => e.currentTarget.style.background = "var(--surface)"} onMouseOut={(e) => e.currentTarget.style.background = "var(--bg)"}>
                  View Original Posting ↗
                </a>
              )}
              {job.apply_url && (
                <a href={job.apply_url} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", padding: "10px", background: "var(--accent)", color: "white", borderRadius: "6px", textDecoration: "none", fontWeight: 600, transition: "opacity 0.2s" }} onMouseOver={(e) => e.currentTarget.style.opacity = "0.85"} onMouseOut={(e) => e.currentTarget.style.opacity = "1"}>
                  Apply Now ↗
                </a>
              )}
            </div>
          </div>

          {/* Company Details Card */}
          {Boolean(job.company_logo_url || job.company_slogan || job.company_description || job.company_address || job.company_website || job.company_linkedin_url) && (
             <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                <h3 style={{ fontSize: "1.1rem", margin: "0 0 16px 0", color: "var(--ink)" }}>About the Company</h3>
                {job.company_logo_url && (
                  <img src={job.company_logo_url} alt={`${job.company ?? "Company"} logo`} style={{ width: 64, height: 64, objectFit: "contain", marginBottom: 16, borderRadius: "8px", background: "white", padding: 4 }} />
                )}
                {job.company_slogan && <p style={{ fontSize: "1.05rem", fontWeight: 600, margin: "0 0 12px 0", color: "var(--accent)" }}>{job.company_slogan}</p>}
                {job.company_description && <div style={{ fontSize: "0.95rem", lineHeight: 1.5, color: "var(--ink-soft)", marginBottom: 16 }}><LongText value={job.company_description} /></div>}
                
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                   {job.company_employees_count && <Field label="Company size" value={`${job.company_employees_count} employees`} />}
                   {job.company_address ? <Field label="Address" value={formatAddress(job.company_address)} /> : null}
                   {job.company_website && <Field label="Website" value={<a href={job.company_website} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{job.company_website}</a>} />}
                   {job.company_linkedin_url && <Field label="LinkedIn" value={<a href={job.company_linkedin_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>View Profile</a>} />}
                </div>
             </div>
          )}

          {/* Job Poster Card */}
          {(job.job_poster_name || job.job_poster_title || job.job_poster_profile_url) && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
              <h3 style={{ fontSize: "1.1rem", margin: "0 0 16px 0", color: "var(--ink)" }}>Job Poster</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field label="Name" value={job.job_poster_profile_url ? <a href={job.job_poster_profile_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 500 }}>{job.job_poster_name ?? "View profile"}</a> : <span style={{ fontWeight: 500 }}>{job.job_poster_name}</span>} />
                <Field label="Title" value={job.job_poster_title} />
              </div>
            </div>
          )}
        </div>
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
          <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Score</th>
                <th>Why</th>
                <th>Resume</th>
                <th></th>
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
                      <a href={candidate.resume_url} target="_blank" rel="noreferrer">{candidate.resume_filename || "Uploaded Resume"}</a>
                    ) : <span className="muted">Missing</span>}
                  </td>
                  <td>
                    <button onClick={() => setTailorContext({ candidateId: candidate.id })}>Tailor resume</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Applicants ({job.applicants.length})</h2>

      {job.applicants.length === 0 ? (
        <div className="empty">No one has applied to this job yet.</div>
      ) : (
        <div className="table-shell">
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {job.applicants.map((a) => (
              <tr key={a.application_id}>
                <td>{a.name}</td>
                <td><span className={`badge badge-${a.status}`}>{a.status}</span></td>
                <td>
                  <button onClick={() => setTailorContext({ candidateId: a.candidate_id, applicationId: a.application_id })}>
                    Tailor resume
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {showEdit && (
        <EditJobModal job={job} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />
      )}
      {tailorContext && (
        <TailorResumeModal
          candidateId={tailorContext.candidateId}
          initialJobId={job.id}
          initialApplicationId={tailorContext.applicationId}
          onClose={() => setTailorContext(null)}
          onSaved={() => load()}
        />
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "0.85rem", color: "var(--ink-soft)", fontWeight: 500, margin: 0 }}>{label}</label>
      <div style={{ fontSize: "0.95rem", color: "var(--ink)", wordBreak: "break-word", lineHeight: 1.5 }}>{value ?? "—"}</div>
    </div>
  );
}

function extractExperience(text: string): string | null {
  if (!text) return null;

  const patterns = [
    // 1. "Experience: 3+ years" or "Required Experience: 5 years"
    /(?:required\s+)?experience\s*:\s*([^\n\.;]{2,60})/i,
    // 2. "minimum of 3 years of experience", "at least 5 years experience"
    /((?:minimum(?:\s+of)?|at\s+least|requires?|needs?)\s+(?:\d+(?:\.\d+)?\+?\s*(?:to|-)\s*)?\d+(?:\.\d+)?\+?\s*years?(?:\s+of)?(?:\s+[a-z-]+){0,3}\s+experience)/i,
    // 3. "3-5 years of relevant experience"
    /((?:\d+(?:\.\d+)?\+?\s*(?:to|-)\s*)?\d+(?:\.\d+)?\+?\s*years?(?:\s+of)?(?:\s+[a-z-]+){0,3}\s+experience)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let ext = match[1].trim();
      if (ext.length > 55) ext = ext.substring(0, 55) + '...';
      return ext.charAt(0).toUpperCase() + ext.slice(1);
    }
  }
  return null;
}

function extractWorkAuth(text: string): string | null {
  if (!text) return null;
  if (text.match(/us citizen/i)) return "US Citizenship Required";
  if (text.match(/security clearance/i) || text.match(/clearance required/i)) return "Clearance Required";
  if (text.match(/green card/i)) return "Green Card / PR";
  if (text.match(/authorized to work in the us/i)) return "US Work Auth Required";
  return null;
}

function formatAddress(addr: any): string | null {
  if (!addr) return null;
  if (typeof addr === 'string') return addr;
  const parts = [
    addr.streetAddress,
    addr.addressLocality,
    addr.addressRegion,
    addr.postalCode,
    addr.addressCountry
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : JSON.stringify(addr);
}

function LongText({ value }: { value: string }) {
  return <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{value}</p>;
}

function SmartDescription({ text }: { text: string }) {
  if (!text) return <p className="muted">No description provided.</p>;
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  
  return (
    <div style={{ lineHeight: 1.7, color: "var(--ink)", fontSize: "0.95rem" }}>
      {paragraphs.map((p, i) => {
        const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return null;
        
        const firstLine = lines[0].toLowerCase();
        let isHeader = false;
        let icon = null;
        
        if (lines.length === 1 && lines[0].length < 70 && !lines[0].endsWith('.') && !lines[0].endsWith(',')) {
          isHeader = true;
          if (firstLine.includes('responsibilit') || firstLine.includes('what you will do') || firstLine.includes('impact') || firstLine.includes('duty') || firstLine.includes('duties')) icon = '📋';
          else if (firstLine.includes('require') || firstLine.includes('must have') || firstLine.includes('qualif') || firstLine.includes('succeed')) icon = '⭐';
          else if (firstLine.includes('prefer') || firstLine.includes('nice to have')) icon = '✨';
          else if (firstLine.includes('experience') || firstLine.includes('background')) icon = '💼';
          else if (firstLine.includes('educat') || firstLine.includes('degree')) icon = '🎓';
          else if (firstLine.includes('benefit') || firstLine.includes('reward') || firstLine.includes('perk')) icon = '🎁';
          else if (firstLine.includes('about')) icon = '🏢';
        }

        if (isHeader) {
           return (
             <h3 key={i} style={{ marginTop: 24, marginBottom: 12, color: "var(--ink)", fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
               {icon && <span>{icon}</span>}
               {lines[0]}
             </h3>
           );
        }

        return (
          <div key={i} style={{ marginBottom: 16 }}>
            {lines.map((line, j) => {
               if (line.includes(':') && line.length < 150 && !line.includes('http')) {
                 const idx = line.indexOf(':');
                 const key = line.slice(0, idx);
                 const rest = line.slice(idx + 1);
                 return (
                   <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                     <strong style={{ minWidth: 140, color: "var(--ink)" }}>{key}:</strong>
                     <span style={{ color: "var(--ink-soft)" }}>{rest}</span>
                   </div>
                 );
               }
               if (line.startsWith('-') || line.startsWith('•') || line.startsWith('*')) {
                  return <div key={j} style={{ display: "flex", gap: 8, marginBottom: 4, paddingLeft: 12 }}><span style={{ color: "var(--accent)" }}>•</span><span>{line.replace(/^[-•*]\s*/, '')}</span></div>;
               }
               return <p key={j} style={{ margin: "0 0 8px 0" }}>{line}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string | null | undefined }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", transition: "transform 0.15s ease", cursor: "default" }} onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-2px)"} onMouseOut={(e) => e.currentTarget.style.transform = "none"}>
      <div style={{ width: 44, height: 44, borderRadius: "10px", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem" }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)", marginBottom: 4, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: "1rem", color: "var(--ink)", fontWeight: 600 }}>{value || "Not specified"}</div>
      </div>
    </div>
  );
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
          <div className="metric-card" style={{ background: "var(--surface)", marginTop: 12, padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div className="metric-content">
              <span className="metric-label" style={{ display: "block", fontSize: "0.8rem", color: "var(--ink-soft)" }}>Experience Required</span>
              <span className="metric-value">
                {/* @ts-ignore */}
                {job.parsed_description?.experience_required || "Not specified"}
              </span>
            </div>
          </div>
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
