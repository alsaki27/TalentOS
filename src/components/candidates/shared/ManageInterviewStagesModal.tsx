"use client";

import { useEffect, useState } from "react";
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
  onCancel,
  onSaved,
}: {
  applicationId: string;
  applicationLabel: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [stages, setStages] = useState<InterviewStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(1);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeZone, setTimeZone] = useState<InterviewTimeZone>(EASTERN_TIME_ZONE);
  const [useArizonaTime, setUseArizonaTime] = useState(false);
  const [format, setFormat] = useState<"online" | "onsite" | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        applyStage(firstScheduled ?? 1, rows);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

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

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Interview Stages</h2>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 14 }}>{applicationLabel}</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
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
                style={{
                  flex: 1, padding: "8px 4px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
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
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Time in selected zone</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <InterviewTimeZoneField
              id={`manage-stage-${selected}-time-zone`}
              value={timeZone}
              onChange={setTimeZone}
              useArizonaTime={useArizonaTime}
              onUseArizonaTimeChange={setUseArizonaTime}
            />
            <div className="field-group">
              <label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as "online" | "onsite" | "")}>
                <option value="">Select format…</option>
                <option value="online">Online</option>
                <option value="onsite">Onsite</option>
              </select>
            </div>
            <div className="field-group">
              <label>Notes (internal only, not shown to the candidate)</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Panel availability, reschedule reason, prep notes…" />
            </div>
            {existingForSelected?.rescheduled_at && (
              <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4 }}>
                ↻ This stage was rescheduled from its original time.
              </div>
            )}
          </>
        )}

        {error && <div style={{ color: "var(--danger, #ef4444)", fontSize: 12, marginTop: 4 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : existingForSelected ? `Save Stage ${selected}` : `Schedule Stage ${selected}`}
          </button>
        </div>
      </div>
    </div>
  );
}
