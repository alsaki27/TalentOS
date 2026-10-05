"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock3 } from "lucide-react";
import {
  CANDIDATE_OPT_STATUS_NOT_PROVIDED,
  formatOptCalendarDate,
  getOptApprovalCountdown,
  type CandidateOptStatusRecord,
} from "@/lib/candidateOptStatus";

type Tone = { accent: string; surface: string; label: string };

const TONES: Record<string, Tone> = {
  neutral: { accent: "#818cf8", surface: "rgba(99,102,241,0.13)", label: "Approval date required" },
  active: { accent: "#34d399", surface: "rgba(16,185,129,0.13)", label: "90-day window active" },
  upcoming: { accent: "#60a5fa", surface: "rgba(59,130,246,0.13)", label: "Window starts soon" },
  attention: { accent: "#fbbf24", surface: "rgba(245,158,11,0.14)", label: "Follow-up recommended" },
  urgent: { accent: "#fb7185", surface: "rgba(244,63,94,0.14)", label: "Window ending" },
  expired: { accent: "#f87171", surface: "rgba(239,68,68,0.12)", label: "90-day window ended" },
  error: { accent: "#a1a1aa", surface: "rgba(113,113,122,0.12)", label: "Countdown unavailable" },
};

function toneFor(countdown: ReturnType<typeof getOptApprovalCountdown>): Tone {
  if (!countdown) return TONES.neutral;
  if (countdown.isExpired) return TONES.expired;
  if (!countdown.hasStarted) return TONES.upcoming;
  if (countdown.daysRemaining <= 14) return TONES.urgent;
  if (countdown.daysRemaining <= 30) return TONES.attention;
  return TONES.active;
}

export function CandidateOptCountdownCard({ candidateId, candidateName, marginBottom = 20 }: { candidateId: string; candidateName: string; marginBottom?: number }) {
  const [record, setRecord] = useState<CandidateOptStatusRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/candidates/${candidateId}/opt-status`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Could not load OPT status");
      setRecord(payload as CandidateOptStatusRecord | null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("candidate-opt-status-updated", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("candidate-opt-status-updated", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [load]);

  const approvalDate = record?.data.approvalDate;
  const hasExactApprovalDate = Boolean(approvalDate && /^\d{4}-\d{2}-\d{2}$/.test(approvalDate));
  const countdown = hasExactApprovalDate ? getOptApprovalCountdown(approvalDate!) : null;
  const tone = loadError ? TONES.error : toneFor(countdown);

  let message = "Save a full approval date in OPT Status to start the 90-day countdown.";
  let daysLabel = "Awaiting date";
  if (loading) {
    message = "Loading the latest approval date…";
    daysLabel = "Loading";
  } else if (loadError) {
    message = "The approval date could not be loaded. This card will refresh automatically.";
    daysLabel = "Unavailable";
  } else if (approvalDate === CANDIDATE_OPT_STATUS_NOT_PROVIDED) {
    message = "The approval date is marked Not Provided. Add the full date to calculate the end date.";
  } else if (approvalDate && !hasExactApprovalDate) {
    message = "A month and year are recorded. A full approval date is needed for an exact 90-day countdown.";
    daysLabel = "Full date needed";
  } else if (countdown && !countdown.hasStarted) {
    message = `The 90-day countdown starts ${formatOptCalendarDate(countdown.approvalDate)}.`;
    daysLabel = `Starts in ${countdown.daysUntilStart} ${countdown.daysUntilStart === 1 ? "day" : "days"}`;
  } else if (countdown?.isExpired) {
    message = `The 90-day window ended ${countdown.daysAfterEnd === 0 ? "today" : `${countdown.daysAfterEnd} ${countdown.daysAfterEnd === 1 ? "day" : "days"} ago`}.`;
    daysLabel = "0 days left";
  } else if (countdown?.endsToday) {
    message = "The 90-day window reaches 0 days today.";
    daysLabel = "0 days left";
  } else if (countdown) {
    message = `There ${countdown.daysRemaining === 1 ? "is" : "are"} ${countdown.daysRemaining} ${countdown.daysRemaining === 1 ? "day" : "days"} left in the 90-day window.`;
    daysLabel = `${countdown.daysRemaining} ${countdown.daysRemaining === 1 ? "day" : "days"} left`;
  }

  const dateValue = (value?: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatOptCalendarDate(value)
    : "Not available";

  return (
    <section
      className="card"
      aria-label={`${candidateName} OPT approval countdown`}
      style={{
        marginBottom,
        padding: 22,
        border: `1px solid ${tone.accent}66`,
        borderRadius: 16,
        background: `linear-gradient(115deg, ${tone.surface}, transparent 68%), var(--card)`,
        boxShadow: `0 12px 32px ${tone.accent}12`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 6px", color: tone.accent, fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            OPT approval tracker
          </p>
          <h2 style={{ margin: 0, color: "var(--ink)", fontSize: 21, lineHeight: 1.25, fontWeight: 750 }}>
            90-day authorization window
          </h2>
          <p style={{ margin: "7px 0 0", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>{message}</p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 11px", border: `1px solid ${tone.accent}55`, borderRadius: 999, color: tone.accent, background: tone.surface, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          <Clock3 size={15} aria-hidden="true" /> {tone.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 12, marginTop: 18 }}>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: `1px solid ${tone.accent}44`, background: tone.surface }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>Time remaining</p>
          <div style={{ marginTop: 6, color: tone.accent, fontSize: 34, lineHeight: 1.15, fontWeight: 800 }}>{daysLabel}</div>
          <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>Updates automatically each day</p>
        </div>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 76%, transparent)" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>Approval date</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "var(--ink)", fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
            <CalendarClock size={18} color={tone.accent} aria-hidden="true" />
            <span>{dateValue(approvalDate)}</span>
          </div>
          <p style={{ margin: "5px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>Countdown starts on this date</p>
        </div>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 76%, transparent)" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>90-day window ends</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "var(--ink)", fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
            <CalendarClock size={18} color={tone.accent} aria-hidden="true" />
            <span>{countdown ? formatOptCalendarDate(countdown.endDate) : "Not available"}</span>
          </div>
          <p style={{ margin: "5px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>Approval date plus 90 calendar days</p>
        </div>
      </div>
    </section>
  );
}
