"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import ApplicationsDataTable, { type DashboardApplication } from "./shared/ApplicationsDataTable";
import type { InterviewDetails } from "./shared/ScheduleInterviewModal";
import ApplicationNotesModal from "./shared/ApplicationNotesModal";

type InterviewRecord = DashboardApplication & {
  application_resume_filename?: string | null;
  application_stage?: string | null;
};

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}

function CustomInterviewForm({
  candidateId,
  interview,
  onClose,
  onSaved,
}: {
  candidateId: string;
  interview: InterviewRecord | null;
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
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onSubmit={save} onClick={(event) => event.stopPropagation()} style={{ maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }}>
        <h2>{interview ? "Edit custom interview" : "Add custom interview"}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 16 }}>
          This creates an interview-stage application record and syncs it to Application Records and the candidate portal.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
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
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : interview ? "Save changes" : "Add interview"}</button>
        </div>
      </form>
    </div>
  );
}

export default function CustomInterviewHub({ candidateId, candidateName }: { candidateId: string; candidateName: string }) {
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formInterview, setFormInterview] = useState<InterviewRecord | null | "new">(null);
  const [notesApplicationId, setNotesApplicationId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/candidates/${candidateId}/custom-interviews`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Failed to load interviews.");
      setInterviews(result.interviews ?? []);
    } catch (cause: any) {
      setError(cause?.message || "Failed to load interviews.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { void load(); }, [load]);

  async function changeStatus(applicationId: string, status: string, interviewDetails?: InterviewDetails) {
    setError("");
    try {
      const response = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(interviewDetails ? { status, interview: interviewDetails } : { status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "The application stage could not be updated.");
        return;
      }
      await load();
    } catch {
      setError("The application stage could not be updated. Check your connection and try again.");
    }
  }

  async function removeInterview(interview: InterviewRecord) {
    const label = `${interview.company_name} · ${interview.job_title}`;
    const confirmed = window.confirm(`Remove ${label}? Its application record, interview schedules, panel assignments, and submitted interview feedback will be permanently deleted.`);
    if (!confirmed) return;
    setRemovingId(interview.application_id);
    setError("");
    try {
      const response = await fetch(`/api/candidates/${candidateId}/custom-interviews/${interview.application_id}`, { method: "DELETE", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The interview could not be removed.");
      await load();
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
          <h2 style={{ margin: 0 }}>Interview Hub</h2>
          <p className="muted" style={{ margin: "5px 0 0", fontSize: 12 }}>
            Current interview-stage applications for {candidateName}, including manually added interviews.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setFormInterview("new")}>+ Add interview</button>
      </div>

      {error && <div role="alert" style={{ padding: 10, borderRadius: 8, color: "var(--danger, #ef4444)", background: "rgba(244,63,94,0.08)", fontSize: 12 }}>{error}</div>}
      {loading ? (
        <div className="card" style={{ padding: 24, color: "var(--ink-soft)" }}>Loading interview records…</div>
      ) : interviews.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--ink-soft)" }}>
          No applications are currently at the interview stage. Add an interview to start tracking one here.
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <ApplicationsDataTable
            applications={interviews}
            onStatusChange={changeStatus}
            onNotesOpen={setNotesApplicationId}
            onInterviewsChanged={() => { void load(); }}
            onCustomInterviewEdit={(application) => setFormInterview(application as InterviewRecord)}
            onCustomInterviewRemove={(application) => { void removeInterview(application as InterviewRecord); }}
            readOnly={false}
            totalCount={interviews.length}
            page={1}
            pageSize={Math.max(1, interviews.length)}
            onPageChange={() => undefined}
            sort="applied_at"
            order="desc"
            onSort={() => undefined}
          />
          {removingId && <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>Removing interview…</p>}
        </div>
      )}

      {formInterview !== null && (
        <CustomInterviewForm
          candidateId={candidateId}
          interview={formInterview === "new" ? null : formInterview}
          onClose={() => setFormInterview(null)}
          onSaved={() => { setFormInterview(null); void load(); }}
        />
      )}
      {notesApplicationId && <ApplicationNotesModal applicationId={notesApplicationId} onClose={() => setNotesApplicationId(null)} />}
    </section>
  );
}
