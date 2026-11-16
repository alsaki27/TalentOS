"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, ExternalLink, MapPin, Video, X } from "lucide-react";
import {
  EASTERN_TIME_ZONE, INTERVIEW_TIME_ZONES, ARIZONA_TIME_ZONE, isInterviewTimeZone,
  formatAnyZonedTime, formatZonedDateTime, utcIsoToZonedParts, zonedDateTimeToUtcIso,
} from "@/lib/easternTime";
import {
  INTERVIEW_STAGE_STATUS, safeMeetingUrl,
  type ApplicationInterviewStage, type InterviewPreparationFile,
} from "@/lib/applicationInterviewPreparation";
import { requestJson } from "./ApplicationPreparationFiles";
import InterviewAudioPanel from "@/components/shared/InterviewAudioPanel";
import styles from "./CandidateApplicationWorkspace.module.css";

export function StageEditor({ api, stage, onSaved, onCancel }: {
  api: string;
  stage?: ApplicationInterviewStage;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const zone = isInterviewTimeZone(stage?.time_zone) ? stage.time_zone : EASTERN_TIME_ZONE;
  const initial = utcIsoToZonedParts(stage?.scheduled_at ?? null, zone);
  const [timeZone, setTimeZone] = useState(zone);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [status, setStatus] = useState(stage?.status && Object.hasOwn(INTERVIEW_STAGE_STATUS, stage.status)
    ? stage.status : stage?.scheduled_at ? "scheduled" : "planned");
  const initialStatus = stage?.status || (stage?.scheduled_at ? "scheduled" : "planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mockResult, setMockResult] = useState(stage?.mock_interview_taken ?? null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const keptOriginal = stage?.scheduled_at && date === initial.date && time === initial.time && timeZone === zone;
    const scheduledAt = keptOriginal ? stage.scheduled_at : date || time ? zonedDateTimeToUtcIso(date, time, timeZone) : null;
    const keepLegacyDate = stage && !stage.scheduled_at && !date && !time && status === initialStatus;
    if (!keepLegacyDate && !scheduledAt && (date || time || !["planned", "cancelled"].includes(status))) {
      setError("Enter a valid date and time in the selected time zone.");
      return;
    }
    const readText = (field: string) => String(form.get(field) ?? "").trim();
    const values = {
      roundName: readText("roundName"), ...(!keepLegacyDate ? { scheduledAt, status } : {}), timeZone,
      ...(form.get("format") ? { format: form.get("format") } : {}), durationMinutes: Number(form.get("duration")),
      location: readText("location"), meetingLink: readText("meetingLink"),
      notes: readText("notes"), preparationNotes: readText("preparationNotes"),
      ...(stage && mockResult !== null ? { mockInterviewTaken: mockResult } : {}),
    };
    const initialValues: Record<string, unknown> = {
      roundName: stage?.round_name || "Interview", scheduledAt: stage?.scheduled_at ?? null, status: initialStatus,
      timeZone: zone, format: stage?.interview_format, durationMinutes: stage?.duration_minutes ?? 60,
      location: stage?.location?.trim() || "", meetingLink: stage?.meeting_link?.trim() || "",
      notes: stage?.notes?.trim() || "", preparationNotes: stage?.preparation_notes?.trim() || "",
      mockInterviewTaken: stage?.mock_interview_taken ?? null,
    };
    const updates = stage
      ? Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== initialValues[key]))
      : values;
    if (!Object.keys(updates).length) { onCancel(); return; }
    setBusy(true);
    setError("");
    try {
      await requestJson(stage ? api + "/" + stage.id : api, {
        method: stage ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={styles.form}>
      <div className={styles.fields}>
        <label>Stage name<input name="roundName" required maxLength={120} defaultValue={stage?.round_name || "Interview"} /></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
          {Object.entries(INTERVIEW_STAGE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        <label>Time zone<select value={timeZone} onChange={(event) => { if (isInterviewTimeZone(event.target.value)) setTimeZone(event.target.value); }}>
          {INTERVIEW_TIME_ZONES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          <option value={ARIZONA_TIME_ZONE}>Arizona (MST year-round)</option>
        </select></label>
        <label>Duration in minutes<input name="duration" type="number" min={1} max={1440} required defaultValue={stage?.duration_minutes ?? 60} /></label>
        <label>Format<select name="format" defaultValue={stage ? stage.interview_format ?? "" : "online"}>
          {stage && !stage.interview_format && <option value="">Unspecified</option>}
          <option value="online">Online</option><option value="onsite">Onsite</option>
        </select></label>
        <label>Location<input name="location" maxLength={500} defaultValue={stage?.location ?? ""} /></label>
      </div>
      <label>Meeting link<input name="meetingLink" type="url" maxLength={2000} defaultValue={stage?.meeting_link ?? ""} /></label>
      <label>Candidate preparation notes<textarea name="preparationNotes" maxLength={10000} defaultValue={stage?.preparation_notes ?? ""} placeholder="Instructions the candidate will see in the portal" /></label>
      <label>Staff notes<textarea name="notes" maxLength={10000} defaultValue={stage?.notes ?? ""} /></label>
      {stage && <fieldset className={styles.mockOptions} disabled={busy}>
        <legend>Mock interview taken?</legend>
        <label><input type="radio" name="mockInterviewTaken" checked={mockResult === true} onChange={() => setMockResult(true)} />
          <span aria-hidden="true">{mockResult === true && <Check size={12} />}</span> Yes</label>
        <label><input type="radio" name="mockInterviewTaken" checked={mockResult === false} onChange={() => setMockResult(false)} />
          <span aria-hidden="true">{mockResult === false && <Check size={12} />}</span> No</label>
      </fieldset>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : stage ? "Save stage" : "Add stage"}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

export function InterviewStageCard({ stage, files, api, candidateZone, onChange }: {
  stage: ApplicationInterviewStage;
  files: InterviewPreparationFile[];
  api: string;
  candidateZone: string | null;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const fileUrl = api + "/" + stage.id + "/preparation";
  const meetingUrl = safeMeetingUrl(stage.meeting_link);
  const localTime = stage.scheduled_at && candidateZone && stage.time_zone !== candidateZone
    ? formatAnyZonedTime(stage.scheduled_at, candidateZone) : null;
  const status = stage.status || (stage.scheduled_at ? "scheduled" : "planned");

  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setEditing(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, editing]);

  async function removeStage() {
    if (!window.confirm(
      `Remove Stage ${stage.round_number}? Its panel assignments and feedback will be deleted, and its audio will no longer be accessible here or in the portal. Remaining stages will be renumbered.`
    )) return;
    setRemoving(true);
    setError("");
    try {
      await requestJson(api + "/" + stage.id, {
        method: "DELETE",
      });
      setEditing(false);
      onChange();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <article className={styles.round} data-status={status} id={"interview-" + stage.id}>
        <div className={styles.heading}>
          <div className={styles.roundTitle}>
            <span className={styles.roundNumber} aria-label={"Stage " + stage.round_number}>{stage.round_number}</span>
            <div><h3>{stage.round_name}</h3><p className={styles.muted}>Interview stage {stage.round_number}</p></div>
            <span className={styles.stageBadge} data-status={status}>{INTERVIEW_STAGE_STATUS[status] ?? status.replace(/_/g, " ")}</span>
            {stage.rescheduled_at && <span className={styles.rescheduledBadge}>Rescheduled</span>}
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={removing} onClick={() => setEditing(true)}>Edit stage</button>
            <button className={styles.removeStage} type="button" disabled={removing} onClick={() => void removeStage()}>
              {removing ? "Removing…" : "Remove stage"}
            </button>
          </div>
        </div>
        <div className={styles.stageFacts}>
          <div><span>When</span><strong>{stage.scheduled_at ? formatZonedDateTime(stage.scheduled_at, stage.time_zone) : "Date and time not added"}</strong>
            {localTime && <small>Candidate local time · {localTime}</small>}
            {stage.rescheduled_at && <small>Rescheduled on {formatZonedDateTime(stage.rescheduled_at, stage.time_zone)}</small>}
            {stage.rescheduled_at && stage.previous_scheduled_at && <small>Previously {formatZonedDateTime(stage.previous_scheduled_at, stage.previous_time_zone || stage.time_zone)}</small>}</div>
          <div><span>Format</span><strong>{stage.interview_format === "online" ? "Online" : stage.interview_format === "onsite" ? "Onsite" : "Not added"}</strong>
            {stage.duration_minutes && <small>{stage.duration_minutes} minutes</small>}</div>
          <div><span>Location</span><strong>{stage.location ? <><MapPin size={13} /> {stage.location}</> : "Location not added"}</strong></div>
          <div><span>Meeting link</span>{meetingUrl && status !== "cancelled"
            ? <a className={styles.textLink} href={meetingUrl} target="_blank" rel="noreferrer"><Video size={14} /> Open meeting <ExternalLink size={12} /></a>
            : <strong>{stage.meeting_link ? "Link unavailable" : "Meeting link not added"}</strong>}</div>
        </div>
        <div className={styles.stageNotes}>
          <div><span>Candidate preparation</span><p>{stage.preparation_notes || "Preparation notes not added."}</p></div>
          <div><span>Staff notes</span><p>{stage.notes || "Staff notes not added."}</p></div>
        </div>
        <dl className={styles.mockSummary}>
          <dt>Mock interview taken?</dt>
          <dd>{stage.mock_interview_taken === true ? "Yes" : stage.mock_interview_taken === false ? "No" : "Not recorded"}</dd>
        </dl>
        <div className={styles.stageFileSummary}>
          <div className={styles.sectionLabel}><h4>Interview audio</h4></div>
          <InterviewAudioPanel files={files} endpoint={fileUrl} onChange={onChange} />
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </article>

      {editing && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(false); }}>
        <section className={styles.stageModal} role="dialog" aria-modal="true" aria-labelledby={"edit-stage-title-" + stage.id}>
          <header className={styles.stageModalHeader}>
            <div><span className={styles.eyebrow}>INTERVIEW STAGE {stage.round_number}</span><h2 id={"edit-stage-title-" + stage.id}>Edit {stage.round_name}</h2>
              <p>Update timing, candidate instructions, staff notes, and interview audio.</p></div>
            <button className={styles.iconButton} type="button" aria-label="Close stage editor" onClick={() => setEditing(false)} disabled={busy}><X size={19} /></button>
          </header>
          <div className={styles.stageModalBody}>
            <section className={styles.modalSection}>
              <div className={styles.sectionLabel}><h3>Stage details</h3><span>Staff notes stay private.</span></div>
              <StageEditor api={api} stage={stage} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} />
            </section>
            <section className={styles.modalSection}>
              <div className={styles.sectionLabel}><h3>Interview audio</h3></div>
              <InterviewAudioPanel files={files} endpoint={fileUrl} onChange={onChange} onBusyChange={setBusy} />
            </section>
          </div>
        </section>
      </div>}
    </>
  );
}
