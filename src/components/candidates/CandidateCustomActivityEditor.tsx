"use client";
import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parseCustomActivity, type CandidateCustomActivity } from "@/lib/candidateCustomActivity";
import styles from "./CandidateActivity.module.css";

function localParts(value: string | null | undefined, zone: string) {
  if (!value) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(value => value.type === key)?.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
export function CandidateCustomActivityEditor({ candidateId, activity, timeZone, deleting = false, onClose, onSaved }: {
  candidateId: string; activity?: CandidateCustomActivity; timeZone?: string | null; deleting?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const zone = timeZone || activity?.time_zone || "";
  const start = localParts(activity?.starts_at, zone), end = localParts(activity?.ends_at, zone);
  const [draft, setDraft] = useState({ title: activity?.title || "", body: activity?.body || "", link: activity?.link || "",
    schedule_mode: activity?.schedule_mode || "none", start_date: activity?.start_date || start.date, end_date: activity?.end_date || end.date,
    start_time: start.time, end_time: end.time, time_zone: zone });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    try {
      if (!deleting) parseCustomActivity(draft);
      setBusy(true);
      const response = await fetch(`/api/candidates/${candidateId}/activities${activity ? `/${activity.id}` : ""}`, {
        method: deleting ? "DELETE" : activity ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...(activity ? { version: activity.version } : {}) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || "Could not save the activity. Try again.");
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("candidate-activity"); channel.postMessage({ candidateId }); channel.close(); }
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save activity."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={styles.editor}>
    <DialogTitle>{deleting ? "Delete activity" : activity ? "Edit activity" : "Add activity"}</DialogTitle>
    <DialogDescription>{deleting ? `Remove “${activity?.title}” from this candidate’s activity and Next up?` : "Add a note, important date, or a period away. Title and reason are required."}</DialogDescription>
    <form onSubmit={save} className={styles.editorForm}>
      {!deleting && <>
        <label htmlFor={`${id}-title`}>Title <span aria-hidden="true">*</span><input id={`${id}-title`} required maxLength={160} value={draft.title} onChange={event => set("title", event.target.value)} /></label>
        <label htmlFor={`${id}-body`}>Reason / description <span aria-hidden="true">*</span><textarea id={`${id}-body`} required rows={4} maxLength={20000} value={draft.body} onChange={event => set("body", event.target.value)} /></label>
        <label htmlFor={`${id}-link`}>Link <span className={styles.optional}>Optional</span><input id={`${id}-link`} type="url" maxLength={2000} value={draft.link} onChange={event => set("link", event.target.value)} placeholder="https://" /></label>
        <label htmlFor={`${id}-schedule`}>Activity dates<select id={`${id}-schedule`} aria-label="Activity dates" value={draft.schedule_mode} onChange={event => set("schedule_mode", event.target.value)}>
          <option value="none">No date needed</option><option value="date" disabled={!zone}>Single day</option><option value="date_range" disabled={!zone}>Multiple days</option><option value="time_range" disabled={!zone}>Multiple days with start and finish time</option>
        </select></label>
        {!zone && <p className={styles.optional}>Set the candidate’s timezone in Profile overview to add dates or times.</p>}
        {draft.schedule_mode !== "none" && <div className={styles.editorDates}>
          <label htmlFor={`${id}-start`}>{draft.schedule_mode === "date" ? "Date" : "Start date"}<input id={`${id}-start`} type="date" required value={draft.start_date} onChange={event => set("start_date", event.target.value)} /></label>
          {draft.schedule_mode !== "date" && <label htmlFor={`${id}-end`}>End date<input id={`${id}-end`} type="date" required min={draft.start_date} value={draft.end_date} onChange={event => set("end_date", event.target.value)} /></label>}
          {draft.schedule_mode === "time_range" && <>
            <label htmlFor={`${id}-start-time`}>Start time<input id={`${id}-start-time`} type="time" required value={draft.start_time} onChange={event => set("start_time", event.target.value)} /></label>
            <label htmlFor={`${id}-end-time`}>End time<input id={`${id}-end-time`} type="time" required value={draft.end_time} onChange={event => set("end_time", event.target.value)} /></label>
          </>}
          <p className={`${styles.zoneField} ${styles.optional}`}>Candidate’s time zone: <strong>{zone}</strong></p>
        </div>}
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.editorActions}><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy} className={deleting ? "btn-danger" : "btn-primary"}>{busy ? "Saving…" : deleting ? "Delete activity" : "Save activity"}</button></footer>
    </form>
  </DialogContent></Dialog>;
}
