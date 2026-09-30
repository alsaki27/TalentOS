"use client";

import { useState } from "react";
import { easternDateTimeToUtcIso } from "@/lib/easternTime";

export interface InterviewDetails {
  scheduledAt: string; // UTC ISO
  format: "online" | "onsite";
}

interface Props {
  applicationLabel: string; // "Company · Job Title", for the modal heading
  onCancel: () => void;
  onConfirm: (details: InterviewDetails) => void | Promise<void>;
}

export default function ScheduleInterviewModal({ applicationLabel, onCancel, onConfirm }: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [format, setFormat] = useState<"online" | "onsite" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!date || !time || !format) {
      setError("Date, time, and format are all required to mark this application as Interview.");
      return;
    }
    const scheduledAt = easternDateTimeToUtcIso(date, time);
    if (!scheduledAt) {
      setError("Enter a valid date and time.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onConfirm({ scheduledAt, format });
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
          <label>Time (Eastern Time)</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
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
