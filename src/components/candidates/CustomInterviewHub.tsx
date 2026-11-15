"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import CandidateApplicationsDashboard, { type CandidateApplicationRow } from "./CandidateApplicationsDashboard";
import styles from "./CandidateApplicationWorkspace.module.css";

type InterviewRecord = CandidateApplicationRow;

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}

export function CustomInterviewForm({
  candidateId,
  interview,
  onClose,
  onSaved,
}: {
  candidateId: string;
  interview: Pick<InterviewRecord, "application_id" | "job_title" | "company_name" | "location" | "applied_at" | "source_url" | "application_resume_filename"> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [jobTitle, setJobTitle] = useState(interview?.job_title ?? "");
  const [companyName, setCompanyName] = useState(interview?.company_name ?? "");
  const [location, setLocation] = useState(interview?.location ?? "");
  const [appliedAt, setAppliedAt] = useState(dateInputValue(interview?.applied_at));
  const [jobUrl, setJobUrl] = useState(interview?.source_url ?? "");
  const [resume, setResume] = useState<File | null>(null);
  const [clearResume, setClearResume] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!jobTitle.trim() || !companyName.trim()) {
      setError("Job title and company name are required.");
      return;
    }
    const form = new FormData();
    form.set("jobTitle", jobTitle.trim());
    form.set("companyName", companyName.trim());
    form.set("location", location.trim());
    form.set("appliedAt", appliedAt);
    form.set("jobUrl", jobUrl.trim());
    if (resume) form.set("resume", resume);
    if (clearResume) form.set("clearResume", "true");

    setSaving(true);
    try {
      const url = interview
        ? `/api/candidates/${candidateId}/custom-interviews/${interview.application_id}`
        : `/api/candidates/${candidateId}/custom-interviews`;
      const response = await fetch(url, { method: interview ? "PATCH" : "POST", body: form, cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "The interview could not be saved.");
        return;
      }
      onSaved();
    } catch {
      setError("The interview could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className={styles.customInterviewModal} onSubmit={save} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="custom-interview-title-heading">
        <header className={styles.stageModalHeader}>
          <div><span className={styles.eyebrow}>APPLICATION RECORD</span><h2 id="custom-interview-title-heading">{interview ? "Edit interview record" : "Add interview record"}</h2>
            <p>Keep the application, resume, and interview tracking details together.</p></div>
          <button className={styles.iconButton} type="button" aria-label="Close form" onClick={onClose} disabled={saving}><X size={19} /></button>
        </header>
        <div className={styles.customInterviewBody}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          This creates an interview-stage application record and syncs it to Application Records and the candidate portal.
          </p>
        <div className={styles.customInterviewFields}>
          <div className="field-group">
            <label htmlFor="custom-interview-title">Job title *</label>
            <input id="custom-interview-title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={300} required />
          </div>
          <div className="field-group">
            <label htmlFor="custom-interview-company">Company name *</label>
            <input id="custom-interview-company" value={companyName} onChange={(event) => setCompanyName(event.target.value)} maxLength={200} required />
          </div>
          <div className="field-group">
            <label htmlFor="custom-interview-location">Location</label>
            <input id="custom-interview-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} placeholder="City, region, or remote" />
          </div>
          <div className="field-group">
            <label htmlFor="custom-interview-applied-date">Applied date</label>
            <input id="custom-interview-applied-date" type="date" value={appliedAt} onChange={(event) => setAppliedAt(event.target.value)} />
          </div>
        </div>
        <div className="field-group">
          <label htmlFor="custom-interview-job-url">Job link (optional)</label>
          <input id="custom-interview-job-url" type="url" value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} placeholder="https://…" />
        </div>
        <div className="field-group">
          <label htmlFor="custom-interview-resume">Resume (PDF, DOC, or DOCX; up to 15 MB)</label>
          <input id="custom-interview-resume" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { setResume(event.target.files?.[0] ?? null); setClearResume(false); }} />
          {interview?.application_resume_filename && (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>
              Current file: {interview.application_resume_filename}
              <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                <input type="checkbox" checked={clearResume} onChange={(event) => setClearResume(event.target.checked)} disabled={Boolean(resume)} />
                Remove this resume from the application
              </label>
            </div>
          )}
        </div>
        {error && <div role="alert" style={{ color: "var(--danger, #ef4444)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>
        <footer className={styles.modalFooter}>
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : interview ? "Save changes" : "Add interview"}</button>
        </footer>
      </form>
    </div>
  );
}

export default function CustomInterviewHub({ candidateId, candidateName }: { candidateId: string; candidateName: string }) {
  const [error, setError] = useState("");
  const [formInterview, setFormInterview] = useState<InterviewRecord | null | "new">(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  async function removeInterview(interview: CandidateApplicationRow) {
    const label = `${interview.company_name} · ${interview.job_title}`;
    const confirmed = window.confirm(`Remove ${label}? Its application record, interview schedules, panel assignments, and submitted interview feedback will be permanently deleted.`);
    if (!confirmed) return;
    setRemovingId(interview.application_id);
    setError("");
    try {
      const response = await fetch(`/api/candidates/${candidateId}/custom-interviews/${interview.application_id}`, { method: "DELETE", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The interview could not be removed.");
      setRefreshToken((value) => value + 1);
    } catch (cause: any) {
      setError(cause?.message || "The interview could not be removed.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header" style={{ alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Custom Interview</h2>
          <p className="muted" style={{ margin: "5px 0 0", fontSize: 12 }}>
            Manage custom interview records for {candidateName}, with the same filters, details, stages, and activity as Application Records.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setFormInterview("new")}>+ Add interview</button>
      </div>

      {error && <div role="alert" style={{ padding: 10, borderRadius: 8, color: "var(--danger, #ef4444)", background: "rgba(244,63,94,0.08)", fontSize: 12 }}>{error}</div>}
      <CandidateApplicationsDashboard
        candidateId={candidateId}
        customInterviewOnly
        refreshToken={refreshToken}
        onCustomInterviewEdit={setFormInterview}
        onCustomInterviewRemove={(application) => { void removeInterview(application); }}
      />
      {removingId && <p className="muted" style={{ fontSize: 11, margin: "-8px 0 0" }}>Removing interview…</p>}

      {formInterview !== null && (
        <CustomInterviewForm
          candidateId={candidateId}
          interview={formInterview === "new" ? null : formInterview}
          onClose={() => setFormInterview(null)}
          onSaved={() => { setFormInterview(null); setRefreshToken((value) => value + 1); }}
        />
      )}
    </section>
  );
}
