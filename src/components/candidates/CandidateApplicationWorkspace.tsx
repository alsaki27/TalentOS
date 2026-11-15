"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BriefcaseBusiness, CalendarDays, ExternalLink, FileText, MapPin, Plus, X } from "lucide-react";
import { formatZonedDateTime } from "@/lib/easternTime";
import { openFaloodStudio } from "@/lib/falood/openStudio";
import { formatEligibilityRestrictionLabel } from "@/lib/jobEligibilityRestrictions";
import { isInterviewAudio, safeMeetingUrl, INTERVIEW_STAGE_STATUS } from "@/lib/applicationInterviewPreparation";
import { canAccessInterviewDetails } from "@/lib/applicationInterviewAccess";
import type { ApplicationActivity, ApplicationDetailData, ApplicationDetailRecord } from "@/lib/candidateApplicationDetail";
import ApplicationProgress, { applicationStageLabel, currentApplicationStage } from "./shared/ApplicationProgress";
import ApplicationNotesModal from "./shared/ApplicationNotesModal";
import { CustomInterviewForm } from "./CustomInterviewHub";
import { InterviewStageCard, StageEditor } from "./ApplicationInterviewStageCard";
import ApplicationPreparationFiles, { requestJson } from "./ApplicationPreparationFiles";
import styles from "./CandidateApplicationWorkspace.module.css";

const statuses = ["assigned", "stacked", "in_progress", "applied", "replied", "interview", "offer", "rejected", "withdrawn"];
const activityLabels: Record<string, string> = {
  "application.updated": "Next action or follow-up saved",
  "application.interview_scheduled": "Interview scheduled",
  "interview_stage.added": "Interview stage added",
  "interview_stage.updated": "Interview stage edited",
  "interview_stage.rescheduled": "Interview rescheduled",
  "interview_stage.cancelled": "Interview cancelled",
  "interview_file.added": "Preparation file uploaded",
  "interview_file.shared": "Preparation file shared",
  "interview_file.hidden": "Preparation file hidden",
  "interview_file.removed": "Preparation file removed",
  "interview_audio.added": "Interview audio uploaded",
  "interview_audio.shared": "Interview audio shared",
  "interview_audio.hidden": "Interview audio hidden",
  "interview_audio.removed": "Interview audio removed",
  "custom_interview.created": "Custom interview recorded",
  "custom_interview.updated": "Custom interview updated",
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function shortId(value: string | null) {
  return value ? value.slice(0, 8).toUpperCase() : "—";
}

function ActivityItem({ event }: { event: ApplicationActivity }) {
  const statusEvent = event.kind === "status" || event.kind === "stage";
  const rescheduled = event.action === "interview_stage.rescheduled";
  const stageDetail = event.detail && /^\d+$/.test(event.detail) &&
    (event.kind === "interview" || event.action.startsWith("interview_stage.") || event.action === "application.interview_scheduled");
  return (
    <li>
      <strong>{activityLabels[event.action] || event.action}{stageDetail ? " · Stage " + event.detail : ""}</strong>
      {rescheduled ? <div>
        {event.before_value && <div>Previous time · {formatZonedDateTime(event.before_value, event.previous_time_zone)}</div>}
        {event.after_value && <div>New time · {formatZonedDateTime(event.after_value, event.time_zone)}</div>}
      </div> : event.after_value && (
        <div>{statusEvent
          ? [event.before_value && applicationStageLabel(event.before_value), applicationStageLabel(event.after_value)].filter(Boolean).join(" → ")
          : INTERVIEW_STAGE_STATUS[event.after_value] || event.after_value}</div>
      )}
      {event.detail && !stageDetail && <div className={styles.detailsText}>{event.detail}</div>}
      {event.created_at && <time dateTime={event.created_at}>{formatZonedDateTime(event.created_at, null)}{event.actor ? " · " + event.actor : ""}</time>}
    </li>
  );
}

function ApplicationOverview({ application, api, onChange, onInterviewStarted }: {
  application: ApplicationDetailRecord; api: string; onChange: () => void; onInterviewStarted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const followUp = application.follow_up_at?.slice(0, 10) ?? "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      status: String(form.get("status")),
      next_action: String(form.get("next_action")).trim() || null,
      follow_up_at: String(form.get("follow_up_at")) || null,
      notes: String(form.get("notes")).trim() || null,
    };
    const shouldAddInterviewDetails = application.status !== "interview" && values.status === "interview";
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
      key === "follow_up_at" ? value !== (followUp || null) : value !== application[key as "status" | "next_action" | "notes"]
    ));
    if (!Object.keys(patch).length) { setEditing(false); return; }
    setBusy(true);
    setError("");
    try {
      await requestJson(api, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setEditing(false);
      onChange();
      if (shouldAddInterviewDetails) onInterviewStarted();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card + " " + styles.stack}>
      <div className={styles.heading}><h2>Next action</h2>{!editing && <button type="button" onClick={() => setEditing(true)}>Edit application</button>}</div>
      {editing ? (
        <form className={styles.form} onSubmit={save}>
          <div className={styles.fields}>
            <label>Application status<select name="status" defaultValue={application.status}>
              {!statuses.includes(application.status) && <option value={application.status}>{applicationStageLabel(application.status)}</option>}
              {statuses.map((status) => <option key={status} value={status}>{applicationStageLabel(status)}</option>)}
            </select></label>
            <label>Follow-up date<input type="date" name="follow_up_at" defaultValue={followUp} /></label>
          </div>
          <div className={styles.field}>
            <label htmlFor="application-next-action">Next action</label>
            <textarea id="application-next-action" name="next_action" maxLength={2000} defaultValue={application.next_action ?? ""} />
          </div>
          <p className={styles.muted}>A status change uses the workflow’s default follow-up and next action unless you enter replacements here. The candidate can see these fields.</p>
          <label>Application notes for staff<textarea name="notes" maxLength={10000} defaultValue={application.notes ?? ""} /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button disabled={busy} type="submit">{busy ? "Saving…" : "Save application"}</button>
            <button disabled={busy} type="button" onClick={() => { setError(""); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <strong className={styles.detailsText}>{application.next_action || "No next action recorded"}</strong>
          <p className={styles.muted}>Follow-up {dateLabel(application.follow_up_at)}</p>
        </>
      )}
    </section>
  );
}

export default function CandidateApplicationWorkspace({ candidateId, applicationId, backHref = "" }: {
  candidateId: string; applicationId: string; backHref?: string;
}) {
  const [data, setData] = useState<ApplicationDetailData | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const loadSequence = useRef(0);
  const candidatePath = "/candidates/" + candidateId;
  const readPath = "/api" + candidatePath + "/applications/" + applicationId;
  const api = "/api/applications/" + applicationId;
  const interviewsApi = api + "/interviews";

  const reload = useCallback(() => {
    const sequence = ++loadSequence.current;
    setError("");
    requestJson<ApplicationDetailData>(readPath).then((result) => {
      if (sequence === loadSequence.current) setData(result);
    }).catch((cause: Error) => {
      if (sequence === loadSequence.current) setError(cause.message);
    });
  }, [readPath]);

  useEffect(() => {
    reload();
    return () => { ++loadSequence.current; };
  }, [reload]);

  const backLabel = backHref.includes("tab=Custom");
  const back = <Link className={styles.linkButton} href={backHref || candidatePath}><ArrowLeft size={15} /> {backLabel ? "Back to Custom Interview" : "Back to applications"}</Link>;
  if (!data) return (
    <div className={styles.page}>
      <div>{back}</div>
      {error ? <div role="alert" className={styles.card}><p className={styles.error}>{error}</p><button onClick={reload}>Retry</button></div> : <p role="status">Loading application details…</p>}
    </div>
  );

  const { application, activity, stages, files } = data;
  const stage = currentApplicationStage(application.status, application.application_stage, application.ae_stage);
  const history = activity.flatMap((item) => [item.before_value, item.after_value]
    .filter((value): value is string => Boolean(value) && (item.kind === "stage" || item.kind === "status")));
  if (application.applied_at) history.push("applied");
  if (stages.some((item) => item.scheduled_at && item.status !== "cancelled")) history.push("interview");
  const jobUrl = safeMeetingUrl(application.source_url);
  const companyUrl = safeMeetingUrl(application.company_website);
  const resumeUrl = safeMeetingUrl(application.resume_url);
  const archiveUrl = safeMeetingUrl(application.sharepoint_resume_url);
  const canManageInterviewDetails = canAccessInterviewDetails(application.status, application.application_stage, application.ae_stage);

  return (
    <div className={styles.page}>
      <div>{back}</div>
      {error && <div className={styles.toolbar} role="alert"><p className={styles.error}>{error}</p><button onClick={reload}>Reload details</button></div>}
      <header className={styles.card + " " + styles.hero}>
        <div className={styles.heading}>
          <div>
            <p>{application.candidate_name}{application.app_number ? " · A#" + application.app_number : ""}</p>
            <h1>{application.job_title || "Application"}</h1>
            <p>{[application.company_name, application.location].filter(Boolean).join(" · ")}</p>
          </div>
          <span className="badge">{applicationStageLabel(stage)}</span>
        </div>
        <ApplicationProgress stage={stage} history={history} />
      </header>

      <section className={styles.card + " " + styles.stack}>
        <div className={styles.heading}><div><h2>Application links</h2><p className={styles.muted}>Open the original job, resume, or saved copy.</p></div></div>
        <div className={styles.applicationLinkGroups}>
          {(application.job_id || jobUrl || companyUrl) && <section className={styles.applicationLinkGroup} aria-label="Job links">
            <h3>Job</h3><div className={styles.actions}>
              {application.job_id && <Link className={styles.linkButton} href={"/jobs/" + application.job_id}><BriefcaseBusiness size={14} /> Job record</Link>}
              {jobUrl && <a className={styles.linkButton} href={jobUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Job posting</a>}
              {companyUrl && <a className={styles.linkButton} href={companyUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Company website</a>}
            </div>
          </section>}
          {(application.tailored_resume_version_id || archiveUrl || (!archiveUrl && resumeUrl)) && <section className={styles.applicationLinkGroup} aria-label="Resume links">
            <h3>Resume</h3><div className={styles.actions}>
              {application.tailored_resume_version_id && <button className={styles.linkButton} onClick={() => {
                if (application.tailored_resume_version_id) void openFaloodStudio("application_resume_version", application.tailored_resume_version_id);
              }}><FileText size={14} /> Resume Studio</button>}
              {archiveUrl ? <a className={styles.linkButton} href={archiveUrl} target="_blank" rel="noreferrer"><FileText size={14} /> SharePoint</a>
                : resumeUrl && <a className={styles.linkButton} href={resumeUrl} target="_blank" rel="noreferrer" title={application.resume_filename || "Application resume"}><FileText size={14} /> Resume file</a>}
            </div>
          </section>}
          <section className={styles.applicationLinkGroup} aria-label="Application actions">
            <h3>Application</h3><div className={styles.actions}>
              {application.source_type === "custom_interview" && <button className={styles.linkButton} onClick={() => setEditingCustom(true)}>Edit custom interview</button>}
              <button className={styles.linkButton} onClick={() => setShowNotes(true)}>Application notes</button>
            </div>
          </section>
        </div>
        {!application.job_id && !jobUrl && !companyUrl && !application.tailored_resume_version_id && !resumeUrl && !archiveUrl &&
          <p className={styles.muted}>No job or resume links have been added to this record.</p>}
      </section>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <ApplicationOverview application={application} api={api} onChange={reload} onInterviewStarted={() => setAdding(true)} />
          {canManageInterviewDetails ? <section className={styles.card + " " + styles.stack}>
            <div className={styles.heading}>
              <h2><CalendarDays size={16} /> Interview stages <span className={styles.muted}>({stages.length})</span></h2>
              {!adding && <button type="button" onClick={() => setAdding(true)}><Plus size={15} /> Add stage</button>}
            </div>
            {!stages.length && !adding && <p className={styles.muted}>No interview stages recorded yet.</p>}
            {stages.map((item) => <InterviewStageCard key={item.id} stage={item}
              files={files.filter((file) => file.schedule_id === item.id && isInterviewAudio(file))}
              api={interviewsApi} candidateZone={application.candidate_timezone} onChange={reload} />)}
          </section> : <section className={styles.card}>
            <h2>Interview details</h2>
            <p className={styles.muted}>Interview stages and preparation become available when the application reaches Interview.</p>
          </section>}
        </div>

        <aside className={styles.stack}>
          {canManageInterviewDetails && <section className={styles.card + " " + styles.stack + " " + styles.anchorSection} id="preparation-documents">
            <div className={styles.heading}><h2><FileText size={16} /> Preparation documents</h2></div>
            <ApplicationPreparationFiles files={files.filter((file) => !isInterviewAudio(file))}
              endpoint={api + "/preparation"} editable onChange={reload} />
          </section>}
          <section className={styles.card + " " + styles.stack}>
            <div className={styles.heading}><h2>Application details</h2></div>
            <dl className={styles.detailFacts}>
              <div><dt>Role</dt><dd>{application.job_title || "Not recorded"}</dd></div>
              <div><dt>Company</dt><dd>{application.company_name || "Not recorded"}</dd></div>
              <div><dt>Location</dt><dd>{application.location ? <><MapPin size={13} /> {application.location}</> : "Not recorded"}</dd></div>
              <div><dt>Job ID</dt><dd>{shortId(application.job_id)}</dd></div>
              <div><dt>Source</dt><dd>{application.job_source?.replace(/[_-]+/g, " ") || "Not recorded"}</dd></div>
              <div><dt>Status</dt><dd>{applicationStageLabel(stage)}</dd></div>
              <div><dt>Applied</dt><dd>{dateLabel(application.applied_at)}</dd></div>
              <div><dt>Application logged</dt><dd>{dateLabel(application.created_at)}</dd></div>
              {application.fit_score != null && <div><dt>Job fit</dt><dd>{application.fit_score}{application.recommendation ? " · " + application.recommendation : ""}</dd></div>}
            </dl>
            {application.eligibility_restricted && <p className={styles.note}><strong>{formatEligibilityRestrictionLabel(application)}</strong>
              {application.eligibility_restriction_evidence && <><br />{application.eligibility_restriction_evidence}</>}
            </p>}
            {application.notes && <div className={styles.staffNotes}><strong>Staff notes</strong><p>{application.notes}</p></div>}
          </section>
          <section className={styles.card + " " + styles.stack}>
            <div className={styles.heading}><h2>Activity timeline</h2></div>
            {activity.length ? <ol className={styles.timeline}>{activity.slice(0, 8).map((event) => <ActivityItem key={event.id} event={event} />)}</ol>
              : <p className={styles.muted}>No activity recorded yet.</p>}
            {activity.length > 8 && <details><summary>Show earlier activity</summary><ol className={styles.timeline}>{activity.slice(8).map((event) => <ActivityItem key={event.id} event={event} />)}</ol></details>}
          </section>
        </aside>
      </div>
      {adding && canManageInterviewDetails && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}>
        <section className={styles.stageModal} role="dialog" aria-modal="true" aria-labelledby="add-interview-stage-title">
          <header className={styles.stageModalHeader}>
            <div><span className={styles.eyebrow}>INTERVIEW DETAILS</span><h2 id="add-interview-stage-title">Add interview stage</h2>
              <p>Record the stage, meeting information, and candidate preparation.</p></div>
            <button className={styles.iconButton} type="button" aria-label="Close interview stage form" onClick={() => setAdding(false)}><X size={19} /></button>
          </header>
          <div className={styles.stageModalBody}>
            <section className={styles.modalSection}>
              <div className={styles.sectionLabel}><h3>Stage details</h3></div>
              <StageEditor api={interviewsApi} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
            </section>
            <section className={styles.modalSection}>
              <div className={styles.sectionLabel}><h3>Interview audio</h3></div>
              <p className={styles.muted}>Save the stage, then choose <strong>Edit stage</strong> to attach a recording.</p>
            </section>
          </div>
        </section>
      </div>}
      {showNotes && <ApplicationNotesModal applicationId={applicationId} onClose={() => setShowNotes(false)} />}
      {editingCustom && <CustomInterviewForm candidateId={candidateId} interview={{
        application_id: applicationId,
        job_title: application.job_title ?? "",
        company_name: application.company_name ?? "",
        location: application.location,
        applied_at: application.applied_at,
        source_url: application.source_url,
        application_resume_filename: application.resume_filename,
      }} onClose={() => setEditingCustom(false)} onSaved={() => { setEditingCustom(false); reload(); }} />}
    </div>
  );
}
