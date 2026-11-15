"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronUp, ExternalLink, Video, Trash2, FileText, Headphones } from "lucide-react";
import { formatZonedDateTime } from "@/lib/easternTime";
import { INTERVIEW_STAGE_STATUS, isInterviewAudio, safeMeetingUrl } from "@/lib/applicationInterviewPreparation";
import ApplicationPreparationFiles from "@/components/candidates/ApplicationPreparationFiles";
import type { InterviewPreparationFile } from "@/lib/applicationInterviewPreparation";
import ApplicationProgress from "@/components/candidates/shared/ApplicationProgress";
import type { CandidatePortalApplicationDetail as ApplicationDetail } from "@/lib/candidatePortalDashboardService";
import ResumePdfModal from "./ResumePdfModal";

interface Props {
  application: ApplicationDetail;
  resume: any;
  candidateName?: string;
  onBack: () => void;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string | null, timeZone: string | null) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be confirmed";
  return formatZonedDateTime(value, timeZone);
}

function CollapsibleCard({ title, defaultOpen = true, children, id }: {
  title: string; defaultOpen?: boolean; children: ReactNode; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="portal-card portal-detail-card" id={id}>
      <button type="button" className="portal-collapsible-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h2>{title}</h2>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {open && children}
    </section>
  );
}

function PortalInterviewStage({ interview, audio, endpoint }: {
  interview: ApplicationDetail["interviews"][number];
  audio: InterviewPreparationFile[];
  endpoint: string;
}) {
  const meeting = safeMeetingUrl(interview.meeting_link);
  const canJoin = meeting && ["planned", "scheduled", "in_progress"].includes(interview.status);
  const needsNewDate = interview.status === "cancelled" && !interview.scheduled_at;
  return (
    <article className="portal-interview-stage" id={`interview-${interview.id}`} data-status={interview.status}>
      <header className="portal-interview-stage-header">
        <div>
          <span className="portal-interview-stage-number">Stage {interview.round_number}</span>
          <h3>{interview.round_name || "Interview"}</h3>
        </div>
        <div className="portal-interview-statuses">
          <span className="portal-interview-status" data-status={interview.status}>
            {INTERVIEW_STAGE_STATUS[interview.status] ?? interview.status.replace(/_/g, " ")}
          </span>
          {interview.rescheduled && <span className="portal-interview-status" data-status="rescheduled">Rescheduled</span>}
        </div>
      </header>
      <div className="portal-interview-time">
        <CalendarDays size={16} aria-hidden="true" />
        <div>
          <strong>{needsNewDate ? "No scheduled date" : formatTime(interview.scheduled_at, interview.time_zone)}</strong>
          {interview.rescheduled && interview.previous_scheduled_at &&
            <small>Previously {formatTime(interview.previous_scheduled_at, interview.previous_time_zone || interview.time_zone)}</small>}
          {interview.rescheduled_at &&
            <small>Rescheduled on {formatTime(interview.rescheduled_at, interview.time_zone)}</small>}
        </div>
      </div>
      <dl className="portal-interview-facts">
        {interview.interview_format && <div><dt>Format</dt><dd>{interview.interview_format === "online" ? "Online" : "Onsite"}</dd></div>}
        {interview.duration_minutes && <div><dt>Duration</dt><dd>{interview.duration_minutes} min</dd></div>}
        {interview.location && <div><dt>Location</dt><dd>{interview.location}</dd></div>}
        {interview.panel.length > 0 && <div><dt>Interviewers</dt><dd>{interview.panel.join(", ")}</dd></div>}
        {typeof interview.mock_interview_taken === "boolean" &&
          <div><dt>Mock interview</dt><dd>{interview.mock_interview_taken ? "Taken" : "Not taken"}</dd></div>}
      </dl>
      {canJoin && <a className="portal-btn portal-btn-secondary portal-btn-small portal-interview-meeting" href={meeting}
        target="_blank" rel="noreferrer"><Video size={14} /> Open meeting</a>}
      {interview.preparation_notes && <section className="portal-interview-notes">
        <h4>Preparation notes</h4>
        <p>{interview.preparation_notes}</p>
      </section>}
      {audio.length > 0 && <section className="portal-interview-media">
        <h4><Headphones size={15} /> Interview recordings</h4>
        <ApplicationPreparationFiles files={audio} endpoint={endpoint} audio />
      </section>}
    </article>
  );
}

// The document itself is never rendered on the page - it only ever appears
// inside the protected viewer, which is the single surface where the
// watermarking and capture deterrence apply. Showing it inline as well would
// hand out an unprotected copy of the same content and make all of that
// pointless, so this section is deliberately just the heading and the button.
function ResumePreview({ resume, candidateName }: { resume: any; candidateName?: string }) {
  const [pdfOpen, setPdfOpen] = useState(false);

  if (!resume) return (
    <div className="portal-empty portal-detail-empty">
      <div className="portal-empty-icon"><FileText size={26} /></div>
      <strong>Tailored resume is not ready yet.</strong>
      <span>It will appear here when the application resume workflow completes.</span>
    </div>
  );

  return (
    <div className="portal-resume-preview">
      <div className="portal-resume-heading">
        <div><div className="portal-eyebrow">Tailored resume</div><h2>{resume.title}</h2><p>{resume.version_label || "Application version"} · Updated {formatDate(resume.updated_at)}</p></div>
        <div className="portal-resume-actions">
          <span className="portal-resume-pill portal-resume-ready">Approved · View only</span>
          {resume.content && (
            <button type="button" className="portal-btn portal-btn-primary portal-btn-small" onClick={() => setPdfOpen(true)}>
              <ExternalLink size={13} style={{ marginRight: 4 }} />View PDF
            </button>
          )}
        </div>
      </div>
      <p className="portal-greeting-sub">This tailored resume opens in a protected, view-only viewer and cannot be downloaded.</p>

      {pdfOpen && (
        <ResumePdfModal
          content={resume.content}
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
  const scrolledToHash = useRef(false);
  const files = application.preparation_files ?? [];
  const documents = files.filter((file) => !isInterviewAudio(file));
  const preparationApi = `/api/portal/me/applications/${application.id}`;

  // Links from the interview schedule point at #interview-<id>. Scroll once when
  // the page first has interviews, not on every 15-second refresh.
  useEffect(() => {
    if (scrolledToHash.current || !application.interviews?.length) return;
    scrolledToHash.current = true;
    if (!window.location.hash.startsWith("#interview-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [application.interviews]);

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
          <p>{application.job?.company || "Company unavailable"}{application.job?.location ? ` · ${application.job.location}` : application.missing_info?.includes("Location") ? " · Location not provided" : ""}</p>
        </div>
        <span className="portal-detail-status">{application.public_status.label}</span>
      </div>
      <div className="portal-card portal-detail-card">
        <ApplicationProgress stage={application.status} history={[
          ...(application.application_date ? ["applied"] : []),
          ...application.timeline.flatMap((event) => [event.from_label, event.to_label]
            .filter((label): label is string => Boolean(label)).map((label) => label.toLowerCase())),
          ...(application.interviews.some((interview) => interview.scheduled_at && interview.status !== "cancelled") ? ["interview"] : []),
        ]} />
      </div>

      {(application.interviews.length > 0 || files.length > 0) && <a className="portal-btn portal-btn-secondary portal-preparation-jump" href="#interview-preparation">
        <FileText size={15} /> Go to interview preparation
      </a>}
      <div className="portal-detail-layout">
        <div className="portal-detail-main">
          <CollapsibleCard title="Application overview">
            <dl className="portal-detail-facts">
              <div><dt>Applied date</dt><dd>{application.missing_info?.includes("Applied date") ? "Not provided" : formatDate(application.application_date ?? application.submitted_at)}</dd></div>
              {application.application_resume_provided !== null && application.application_resume_provided !== undefined && (
                <div><dt>Resume</dt><dd>{application.application_resume_provided ? "Provided" : "Not provided"}</dd></div>
              )}
              <div><dt>Next action</dt><dd>{application.next_action || "No action scheduled"}</dd></div>
              <div><dt>Follow-up</dt><dd>{formatDate(application.follow_up_at)}</dd></div>
            </dl>
            {application.job?.source_url && <a className="portal-btn portal-btn-secondary" href={application.job.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13} style={{ marginRight: 4 }} />View job posting</a>}
            {!application.job?.source_url && application.missing_info?.includes("Job link") && <p className="portal-greeting-sub">Job posting link: Not provided.</p>}
          </CollapsibleCard>

          <CollapsibleCard title="Activity timeline">
            {application.timeline?.length ? (
              <div className="portal-timeline">
                {application.timeline.map((event: any) => (
                  <div className="portal-timeline-item" key={event.id}>
                    <span className="portal-timeline-dot" />
                    <div>
                      <strong>{event.label}</strong>
                      <span>{event.time_zone ? formatTime(event.created_at, event.time_zone) : formatDate(event.created_at)}</span>
                      {event.rescheduled && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 5, padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "rgba(255,104,107,0.14)", color: "var(--p-coral)" }}>
                          ↻ Rescheduled
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="portal-greeting-sub">Your application timeline will appear as the team records updates.</p>}
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
          <CollapsibleCard title="Interview preparation" id="interview-preparation">
            <div className="portal-job-preparation">
              <h3><FileText size={16} /> Preparation documents</h3>
              <ApplicationPreparationFiles files={documents} endpoint={preparationApi + "/preparation"} />
            </div>
            {application.interviews.length ? (
              <div className="portal-interview-stages">
                <h3>Interview stages</h3>
                {application.interviews.map((interview) => (
                  <PortalInterviewStage key={interview.id} interview={interview}
                    audio={files.filter((file) => file.schedule_id === interview.id && isInterviewAudio(file))}
                    endpoint={`${preparationApi}/interviews/${interview.id}/preparation`} />
                ))}
              </div>
            ) : <p className="portal-greeting-sub">No interview stages recorded.</p>}
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
