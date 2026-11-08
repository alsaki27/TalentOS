"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import InterviewTimeZoneField from "@/components/InterviewTimeZoneField";
import {
  EASTERN_TIME_ZONE,
  resolveInterviewTimeZone,
  utcIsoToZonedParts,
  zonedDateTimeToUtcIso,
  type InterviewTimeZone,
} from "@/lib/easternTime";

export interface InterviewStage {
  id: string;
  round_number: number;
  scheduled_at: string | null;
  time_zone: string | null;
  interview_format: "online" | "onsite" | null;
  status: string;
  notes: string | null;
  rescheduled_at: string | null;
}

const STAGE_NUMBERS = [1, 2, 3, 4] as const;

export default function ManageInterviewStagesModal({
  applicationId,
  applicationLabel,
  initialStage,
  onCancel,
  onSaved,
}: {
  applicationId: string;
  applicationLabel: string;
  initialStage?: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [portalReady, setPortalReady] = useState(false);
  const [stages, setStages] = useState<InterviewStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(initialStage ?? 1);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeZone, setTimeZone] = useState<InterviewTimeZone>(EASTERN_TIME_ZONE);
  const [useArizonaTime, setUseArizonaTime] = useState(false);
  const [format, setFormat] = useState<"online" | "onsite" | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!portalReady) return;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - root.clientWidth;

    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [portalReady, onCancel]);

  function applyStage(round: number, rows: InterviewStage[]) {
    setSelected(round);
    setError(null);
    const existing = rows.find((s) => s.round_number === round);
    if (existing) {
      const zone = (existing.time_zone as InterviewTimeZone) || EASTERN_TIME_ZONE;
      const parts = utcIsoToZonedParts(existing.scheduled_at, zone);
      setDate(parts.date);
      setTime(parts.time);
      setTimeZone(zone);
      setUseArizonaTime(zone === "America/Phoenix");
      setFormat(existing.interview_format || "");
      setNotes(existing.notes || "");
    } else {
      setDate("");
      setTime("");
      setTimeZone(EASTERN_TIME_ZONE);
      setUseArizonaTime(false);
      setFormat("");
      setNotes("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/interviews`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((data) => {
        if (cancelled) return;
        const rows: InterviewStage[] = data.stages || [];
        setStages(rows);
        const firstScheduled = STAGE_NUMBERS.find((n) => rows.some((s) => s.round_number === n));
        const requestedStage = initialStage && STAGE_NUMBERS.includes(initialStage as (typeof STAGE_NUMBERS)[number])
          ? initialStage
          : firstScheduled ?? 1;
        applyStage(requestedStage, rows);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applicationId, initialStage]);

  async function handleRemove() {
    if (!existingForSelected) return;
    const confirmed = window.confirm(
      `Remove Stage ${selected}? This also removes any panel members assigned and any feedback already submitted for this stage. This cannot be undone.`
    );
    if (!confirmed) return;
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/interviews/${existingForSelected.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to remove this interview stage.");
        return;
      }
      // Refetch so the stage picker's checkmarks and this round's form both
      // reflect the slot being empty again — ready to schedule from scratch.
      const refreshed = await fetch(`/api/applications/${applicationId}/interviews`, { cache: "no-store" });
      const data = refreshed.ok ? await refreshed.json() : { stages: [] };
      const rows: InterviewStage[] = data.stages || [];
      setStages(rows);
      applyStage(selected, rows);
    } finally {
      setRemoving(false);
    }
  }

  const existingForSelected = stages.find((s) => s.round_number === selected);

  async function handleSave() {
    if (!date || !time || !format) {
      setError("Date, time, and format are all required.");
      return;
    }
    const zone = resolveInterviewTimeZone(timeZone, useArizonaTime);
    const scheduledAt = zonedDateTimeToUtcIso(date, time, zone);
    if (!scheduledAt) {
      setError("That local time is invalid or falls within a daylight-saving transition. Choose another time.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = { scheduledAt, timeZone: zone, format, notes: notes.trim() || null };
      const res = existingForSelected
        ? await fetch(`/api/applications/${applicationId}/interviews/${existingForSelected.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/applications/${applicationId}/interviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, roundNumber: selected }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save this interview stage.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!portalReady) return null;

  return createPortal(
    <div className="modal-overlay interview-stages-modal-overlay" onClick={onCancel}>
      <div className="modal interview-stages-modal" role="dialog" aria-modal="true" aria-labelledby="interview-stages-title" onClick={(e) => e.stopPropagation()}>
        <header className="interview-stages-modal__header">
          <div>
            <div className="interview-stages-modal__eyebrow">INTERVIEW SCHEDULE</div>
            <h2 id="interview-stages-title">Interview Stages</h2>
            <div className="interview-stages-modal__application">{applicationLabel}</div>
          </div>
          <button type="button" className="interview-stages-modal__close" onClick={onCancel} aria-label="Close interview stages">×</button>
        </header>

        <div className="interview-stages-modal__body">
        <div className="interview-stages-modal__stage-picker" role="group" aria-label="Select interview stage">
          {STAGE_NUMBERS.map((n) => {
            const stage = stages.find((s) => s.round_number === n);
            const active = selected === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => applyStage(n, stages)}
                disabled={loading}
                title={stage?.rescheduled_at ? "Rescheduled" : undefined}
                aria-pressed={active}
                style={{
                  flex: 1, minWidth: 0, padding: "8px 4px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                  background: active ? "var(--accent)" : stage ? "rgba(16,185,129,0.10)" : "var(--bg)",
                  color: active ? "#fff" : stage ? "#10b981" : "var(--ink-soft)",
                }}
              >
                Stage {n}{stage ? " ✓" : ""}{stage?.rescheduled_at ? " ↻" : ""}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Loading stages…</div>
        ) : (
          <>
            <div className="field-group">
              <label htmlFor="interview-stage-date">Date</label>
              <input id="interview-stage-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field-group">
              <label htmlFor="interview-stage-time">Time in selected zone</label>
              <input id="interview-stage-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <InterviewTimeZoneField
              id={`manage-stage-${selected}-time-zone`}
              value={timeZone}
              onChange={setTimeZone}
              useArizonaTime={useArizonaTime}
              onUseArizonaTimeChange={setUseArizonaTime}
            />
            <div className="field-group">
              <label htmlFor="interview-stage-format">Format</label>
              <select id="interview-stage-format" value={format} onChange={(e) => setFormat(e.target.value as "online" | "onsite" | "")}>
                <option value="">Select format…</option>
                <option value="online">Online</option>
                <option value="onsite">Onsite</option>
              </select>
            </div>
            {existingForSelected?.rescheduled_at && (
              <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4 }}>
                ↻ This stage was rescheduled from its original time.
              </div>
            )}
            <div className="field-group interview-stages-modal__notes">
              <label htmlFor="interview-stage-notes">Stage notes <span>(internal only)</span></label>
              <textarea id="interview-stage-notes" rows={4} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add panel details, preparation notes, or a reschedule reason…" />
              <div className="interview-stages-modal__hint">Candidates won’t see these notes.</div>
              <div className="interview-stages-modal__counter">{notes.length.toLocaleString()} / 5,000</div>
            </div>
          </>
        )}

        {error && <div role="alert" style={{ color: "var(--danger, #ef4444)", fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>

        <div className="modal-actions interview-stages-modal__actions">
          {existingForSelected && (
            <button
              className="btn"
              onClick={handleRemove}
              disabled={saving || removing || loading}
              style={{ color: "var(--danger, #ef4444)", borderColor: "var(--danger, #ef4444)", marginRight: "auto" }}
              title="Remove this stage entirely so you can schedule it again from scratch"
            >
              {removing ? "Removing…" : `Remove Stage ${selected}`}
            </button>
          )}
          <button className="btn" onClick={onCancel} disabled={saving || removing}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || removing || loading}>
            {saving ? "Saving…" : existingForSelected ? `Save Stage ${selected}` : `Schedule Stage ${selected}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
