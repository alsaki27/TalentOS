"use client";

import { useState } from "react";
import InterviewTimeZoneField from "@/components/InterviewTimeZoneField";
import { EASTERN_TIME_ZONE, resolveInterviewTimeZone, zonedDateTimeToUtcIso, type InterviewTimeZone } from "@/lib/easternTime";

export interface InterviewDetails {
  scheduledAt: string; // UTC ISO
  format: "online" | "onsite";
  timeZone: InterviewTimeZone;
}

interface Props {
  applicationLabel: string; // "Company · Job Title", for the modal heading
  onCancel: () => void;
  onConfirm: (details: InterviewDetails) => void | Promise<void>;
}

export default function ScheduleInterviewModal({ applicationLabel, onCancel, onConfirm }: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeZone, setTimeZone] = useState<InterviewTimeZone>(EASTERN_TIME_ZONE);
  const [useArizonaTime, setUseArizonaTime] = useState(false);
  const [format, setFormat] = useState<"online" | "onsite" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!date || !time || !format) {
      setError("Date, time, and format are all required to mark this application as Interview.");
      return;
    }
    const selectedTimeZone = resolveInterviewTimeZone(timeZone, useArizonaTime);
    const scheduledAt = zonedDateTimeToUtcIso(date, time, selectedTimeZone);
    if (!scheduledAt) {
      setError("That local time is invalid or falls within a daylight-saving transition. Choose another time.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onConfirm({ scheduledAt, format, timeZone: selectedTimeZone });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Schedule Interview</h2>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 16 }}>{applicationLabel}</div>

        <div className="field-group">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Time in selected zone</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <InterviewTimeZoneField
          id="quick-interview-time-zone"
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

        {error && <div style={{ color: "var(--danger, #ef4444)", fontSize: 12, marginTop: 4 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? "Saving…" : "Confirm Interview"}
          </button>
        </div>
      </div>
    </div>
  );
}
