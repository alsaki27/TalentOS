"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Video, Trash2, FileText } from "lucide-react";
import PortalResumeDocument from "./PortalResumeDocument";
import ResumePdfModal from "./ResumePdfModal";

interface Props {
  application: any;
  resume: any;
  candidateName?: string;
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

function CollapsibleCard({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="portal-card portal-detail-card">
      <button type="button" className="portal-collapsible-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h2>{title}</h2>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {open && children}
    </section>
  );
}

function ResumePreview({ resume, candidateName }: { resume: any; candidateName?: string }) {
  const [pdfOpen, setPdfOpen] = useState(false);

  if (!resume) return (
    <div className="portal-empty portal-detail-empty">
      <div className="portal-empty-icon"><FileText size={26} /></div>
      <strong>Tailored resume is not ready yet.</strong>
      <span>It will appear here when the application resume workflow completes.</span>
    </div>
  );

  const pdfUrl = `/api/portal/me/applications/${resume.application_id}/resume-pdf`;

  return (
    <div className="portal-resume-preview">
      <div className="portal-resume-heading">
        <div><div className="portal-eyebrow">Tailored resume</div><h2>{resume.title}</h2><p>{resume.version_label || "Application version"} · Updated {formatDate(resume.updated_at)}</p></div>
        <div className="portal-resume-actions">
          <span className="portal-resume-pill portal-resume-ready">Approved · View only</span>
          {resume.pdf_available && (
            <button type="button" className="portal-btn portal-btn-primary portal-btn-small" onClick={() => setPdfOpen(true)}>
              <ExternalLink size={13} style={{ marginRight: 4 }} />View PDF
            </button>
          )}
        </div>
      </div>
      <p className="portal-greeting-sub">This tailored resume is available for review in TalentOS and cannot be downloaded.</p>

      {/* Rendered through the same adapter + templates the TalentOS studio
          uses, so the candidate sees the identical document, not a
          portal-specific approximation of it. */}
      {resume.content ? (
        <PortalResumeDocument content={resume.content} />
      ) : resume.generated_text ? (
        <pre className="portal-resume-text">{resume.generated_text}</pre>
      ) : null}

      {pdfOpen && (
        <ResumePdfModal
          pdfUrl={pdfUrl}
          title={resume.title || "Tailored resume"}
          viewerLabel={candidateName || "Skarion candidate"}
          onClose={() => setPdfOpen(false)}
        />
      )}
    </div>
  );
}

export default function CandidatePortalApplicationDetail({ application, resume, candidateName, onBack }: Props) {
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
    <div className="portal-detail-shell" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <button className="portal-back-link" onClick={onBack}><ArrowLeft size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Back to applications</button>

      <div className="portal-hero" style={{ background: "linear-gradient(135deg, var(--p-navy-fill), #1c3496 70%, var(--p-coral))" }}>
        <div>
          <div className="portal-eyebrow" style={{ color: "rgba(255,255,255,0.75)" }}>Application details</div>
          <h1>{application.job?.title || "Application"}</h1>
          <p>{application.job?.company || "Company unavailable"}{application.job?.location ? ` · ${application.job.location}` : ""}</p>
        </div>
        <span className="portal-detail-status">{application.public_status.label}</span>
      </div>

      <div className="portal-detail-layout">
        <div className="portal-detail-main">
          <CollapsibleCard title="Application overview">
            <dl className="portal-detail-facts">
              <div><dt>Submitted</dt><dd>{formatDate(application.submitted_at)}</dd></div>
              <div><dt>Source</dt><dd>{application.job?.source || "Unknown"}</dd></div>
              <div><dt>Next action</dt><dd>{application.next_action || "No action scheduled"}</dd></div>
              <div><dt>Follow-up</dt><dd>{formatDate(application.follow_up_at)}</dd></div>
            </dl>
            {application.job?.source_url && <a className="portal-btn portal-btn-secondary" href={application.job.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13} style={{ marginRight: 4 }} />View job posting</a>}
          </CollapsibleCard>

          <CollapsibleCard title="Progress">
            {application.timeline?.length ? (
              <div className="portal-timeline">
                {application.timeline.map((event: any) => <div className="portal-timeline-item" key={event.id}><span className="portal-timeline-dot" /><div><strong>{event.label}</strong><span>{formatDate(event.created_at)}</span></div></div>)}
              </div>
            ) : <p className="portal-greeting-sub">Your application timeline will appear as the team records updates.</p>}
          </CollapsibleCard>

          <CollapsibleCard title="Interviews">
            {application.interviews?.length ? (
              <div className="portal-interview-list">
                {application.interviews.map((interview: any) => (
                  <article className="portal-interview-card" key={interview.id}>
                    <div>
                      <strong>{interview.round_name}</strong>
                      <span>{formatTime(interview.scheduled_at)}{interview.duration_minutes ? ` · ${interview.duration_minutes} min` : ""}</span>
                      <span>Status: {interview.status}</span>
                      {interview.location && <span>Location: {interview.location}</span>}
                      {interview.panel?.length > 0 && <span>Interviewers: {interview.panel.join(", ")}</span>}
                    </div>
                    {interview.meeting_link && <a className="portal-btn portal-btn-secondary portal-btn-small" href={interview.meeting_link} target="_blank" rel="noreferrer"><Video size={13} style={{ marginRight: 4 }} />Open meeting</a>}
                  </article>
                ))}
              </div>
            ) : <p className="portal-greeting-sub">No interviews are scheduled for this application yet.</p>}
          </CollapsibleCard>

          <CollapsibleCard title="My preparation notes">
            <div className="portal-notes-heading">
              <p className="portal-greeting-sub" style={{ margin: 0 }}>Private notes to help you prepare. These are not shared with the Skarion team.</p>
              <span className="portal-count-badge">{notes.length}</span>
            </div>
            <div className="portal-note-composer">
              <textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={5000} placeholder="Add interview prep, questions, or follow-up reminders..." />
              <div><span>{noteBody.length}/5000</span><button className="portal-btn portal-btn-primary" disabled={!noteBody.trim() || savingNote} onClick={addNote}>{savingNote ? "Saving..." : "Add note"}</button></div>
            </div>
            {noteError && <p className="portal-error">{noteError}</p>}
            {notes.length > 0 && (
              <div className="portal-notes-list">
                {notes.map((note) => (
                  <article key={note.id}>
                    <p>{note.body}</p>
                    <div><span>Updated {formatDate(note.updated_at || note.created_at)}</span><button className="portal-note-delete" onClick={() => deleteNote(note.id)}><Trash2 size={12} style={{ verticalAlign: -2, marginRight: 3 }} />Delete</button></div>
                  </article>
                ))}
              </div>
            )}
          </CollapsibleCard>
        </div>

        <div className="portal-detail-side">
          <CollapsibleCard title="Updates">
            {application.updates?.length ? (
              <div className="portal-detail-updates">
                {application.updates.map((update: any) => <article key={update.id}><p>{update.body}</p><span>{update.author} · {formatDate(update.created_at)}</span></article>)}
              </div>
            ) : <p className="portal-greeting-sub">No candidate-visible updates yet.</p>}
          </CollapsibleCard>
        </div>
      </div>

      {/* Full width, below the notes - a resume is a page-shaped document and
          reads far better across the whole column than squeezed into the
          narrow side rail. */}
      <ResumePreview resume={resume} candidateName={candidateName} />
    </div>
  );
}
