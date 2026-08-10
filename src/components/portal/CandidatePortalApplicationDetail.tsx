"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  application: any;
  resume: any;
  onBack: () => void;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string | null) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be confirmed";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(date);
}

function ResumeSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="portal-resume-section"><h3>{title}</h3>{children}</section>;
}

function ResumePreview({ resume, applicationId }: { resume: any; applicationId: string }) {
  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);
  const [downloadError, setDownloadError] = useState("");
  if (!resume) return <div className="portal-empty portal-detail-empty"><strong>Tailored resume is not ready yet.</strong><span>It will appear here when the application resume workflow completes.</span></div>;
  const content = resume.content || {};
  const canGenerateFiles = Boolean(content.header && Array.isArray(content.experience) && Array.isArray(content.education));

  async function download(format: "pdf" | "docx") {
    if (!canGenerateFiles) return;
    setDownloading(format);
    setDownloadError("");
    try {
      const { exportAndDownloadResume } = await import("@/lib/falood/clientExport");
      await exportAndDownloadResume(content, format);
    } catch (error: any) {
      setDownloadError(error?.message || `${format.toUpperCase()} download failed.`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="portal-resume-preview">
      <div className="portal-resume-heading">
        <div><div className="portal-eyebrow">Tailored resume</div><h2>{resume.title}</h2><p>{resume.version_label || "Application version"} · Updated {formatDate(resume.updated_at)}</p></div>
        <div className="portal-resume-actions">
          <span className="portal-resume-pill portal-resume-ready">Approved</span>
          <a className="portal-btn portal-btn-secondary portal-btn-small" href={`/api/portal/me/applications/${applicationId}/resume/download?format=markdown`} download>Markdown</a>
          <button className="portal-btn portal-btn-secondary portal-btn-small" disabled={!canGenerateFiles || downloading !== null} onClick={() => download("pdf")} title={!canGenerateFiles ? "A structured resume is required for PDF export" : undefined}>{downloading === "pdf" ? "Preparing…" : "PDF"}</button>
          <button className="portal-btn portal-btn-secondary portal-btn-small" disabled={!canGenerateFiles || downloading !== null} onClick={() => download("docx")} title={!canGenerateFiles ? "A structured resume is required for DOCX export" : undefined}>{downloading === "docx" ? "Preparing…" : "DOCX"}</button>
        </div>
      </div>
      {downloadError && <p className="portal-error">{downloadError}</p>}
      {!canGenerateFiles && <p className="portal-greeting-sub">PDF/DOCX export will appear when this approved version has structured resume content. Markdown remains available.</p>}
      {content.header?.fullName && <h3 className="portal-resume-name">{content.header.fullName}</h3>}
      {content.header && <p className="portal-resume-contact">{[content.header.location, content.header.email, content.header.phone].filter(Boolean).join(" · ")}</p>}
      {content.summary?.text && <ResumeSection title="Summary"><p>{content.summary.text}</p></ResumeSection>}
      {Array.isArray(content.skills) && content.skills.length > 0 && <ResumeSection title="Skills"><div className="portal-resume-skills">{content.skills.flatMap((section: any) => Array.isArray(section.skills) ? section.skills : []).map((skill: string) => <span key={skill}>{skill}</span>)}</div></ResumeSection>}
      {Array.isArray(content.experience) && content.experience.length > 0 && <ResumeSection title="Experience">{content.experience.map((experience: any) => <article className="portal-resume-entry" key={experience.id || `${experience.company}-${experience.title}`}><strong>{experience.title}</strong><span>{experience.company} · {experience.startDate || ""}{experience.endDate ? ` - ${experience.endDate}` : experience.startDate ? " - Present" : ""}</span><ul>{(experience.bullets || []).map((bullet: any, index: number) => <li key={bullet.id || index}>{bullet.text}</li>)}</ul></article>)}</ResumeSection>}
      {Array.isArray(content.education) && content.education.length > 0 && <ResumeSection title="Education"><ul className="portal-resume-plain-list">{content.education.map((education: any, index: number) => <li key={education.id || index}>{education.degree} · {education.school}{education.graduationDate ? ` (${education.graduationDate})` : ""}</li>)}</ul></ResumeSection>}
      {resume.generated_text && !content.header && <pre className="portal-resume-text">{resume.generated_text}</pre>}
    </div>
  );
}

export default function CandidatePortalApplicationDetail({ application, resume, onBack }: Props) {
  const [notes, setNotes] = useState<any[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/me/applications/${application.id}/notes`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (result) setNotes(result.notes || []); })
      .catch(() => setNoteError("Notes could not be loaded."));
  }, [application.id]);

  async function addNote() {
    const value = noteBody.trim();
    if (!value) return;
    setSavingNote(true);
    setNoteError("");
    const response = await fetch(`/api/portal/me/applications/${application.id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: value }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) setNoteError(result.error || "Note could not be saved.");
    else { setNotes((current) => [result, ...current]); setNoteBody(""); }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const response = await fetch(`/api/portal/me/applications/${application.id}/notes/${noteId}`, { method: "DELETE" });
    if (response.ok) setNotes((current) => current.filter((note) => note.id !== noteId));
  }

  return (
    <div className="portal-shell portal-detail-shell">
      <button className="portal-back-link" onClick={onBack}>← Back to applications</button>
      <div className="portal-detail-hero">
        <div><div className="portal-eyebrow">Application details</div><h1>{application.job?.title || "Application"}</h1><p>{application.job?.company || "Company unavailable"}{application.job?.location ? ` · ${application.job.location}` : ""}</p></div>
        <span className="portal-detail-status">{application.public_status.label}</span>
      </div>
      <div className="portal-detail-grid">
        <section className="portal-card portal-detail-card"><h2>Application overview</h2><dl className="portal-detail-facts"><div><dt>Submitted</dt><dd>{formatDate(application.submitted_at)}</dd></div><div><dt>Source</dt><dd>{application.job?.source || "Unknown"}</dd></div><div><dt>Next action</dt><dd>{application.next_action || "No action scheduled"}</dd></div><div><dt>Follow-up</dt><dd>{formatDate(application.follow_up_at)}</dd></div></dl>{application.job?.source_url && <a className="portal-btn portal-btn-secondary" href={application.job.source_url} target="_blank" rel="noreferrer">View job posting</a>}</section>
        <section className="portal-card portal-detail-card"><h2>Updates</h2>{application.updates?.length ? <div className="portal-detail-updates">{application.updates.map((update: any) => <article key={update.id}><p>{update.body}</p><span>{update.author} · {formatDate(update.created_at)}</span></article>)}</div> : <p className="portal-greeting-sub">No candidate-visible updates yet.</p>}</section>
      </div>
      <section className="portal-card portal-detail-card"><h2>Progress</h2>{application.timeline?.length ? <div className="portal-timeline">{application.timeline.map((event: any) => <div className="portal-timeline-item" key={event.id}><span className="portal-timeline-dot" /><div><strong>{event.label}</strong><span>{formatDate(event.created_at)}</span></div></div>)}</div> : <p className="portal-greeting-sub">Your application timeline will appear as the team records updates.</p>}</section>
      <section className="portal-card portal-detail-card"><h2>Interviews</h2>{application.interviews?.length ? <div className="portal-interview-list">{application.interviews.map((interview: any) => <article className="portal-interview-card" key={interview.id}><div><strong>{interview.round_name}</strong><span>{formatTime(interview.scheduled_at)}{interview.duration_minutes ? ` · ${interview.duration_minutes} min` : ""}</span><span>Status: {interview.status}</span>{interview.location && <span>Location: {interview.location}</span>}{interview.panel?.length > 0 && <span>Interviewers: {interview.panel.join(", ")}</span>}</div>{interview.meeting_link && <a className="portal-btn portal-btn-secondary portal-btn-small" href={interview.meeting_link} target="_blank" rel="noreferrer">Open meeting</a>}</article>)}</div> : <p className="portal-greeting-sub">No interviews are scheduled for this application yet.</p>}</section>
      <section className="portal-card portal-detail-card"><div className="portal-notes-heading"><div><h2>My preparation notes</h2><p className="portal-greeting-sub">Private notes to help you prepare. These are not shared with the Skarion team.</p></div><span className="portal-count-badge">{notes.length}</span></div><div className="portal-note-composer"><textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={5000} placeholder="Add interview prep, questions, or follow-up reminders..." /><div><span>{noteBody.length}/5000</span><button className="portal-btn portal-btn-primary" disabled={!noteBody.trim() || savingNote} onClick={addNote}>{savingNote ? "Saving..." : "Add note"}</button></div></div>{noteError && <p className="portal-error">{noteError}</p>}{notes.length > 0 && <div className="portal-notes-list">{notes.map((note) => <article key={note.id}><p>{note.body}</p><div><span>Updated {formatDate(note.updated_at || note.created_at)}</span><button className="portal-note-delete" onClick={() => deleteNote(note.id)}>Delete</button></div></article>)}</div>}</section>
      <ResumePreview resume={resume} applicationId={application.id} />
    </div>
  );
}
