"use client";

import { useEffect, useState } from "react";
import { Globe, MapPin, Clock3 } from "lucide-react";
import { formatAnyZonedDateTime, formatAnyZonedTime, utcOffsetHours } from "@/lib/easternTime";

// AEs are based in Dhaka - every candidate card compares the candidate's local time
// against it so scheduling an interview is a glance, not a mental timezone-math exercise.
const AE_TIME_ZONE = "Asia/Dhaka";
const AE_TIME_ZONE_LABEL = "Dhaka, Bangladesh";

const TONE_KNOWN = { accent: "#60a5fa", surface: "rgba(59,130,246,0.13)" };
const TONE_UNKNOWN = { accent: "#a1a1aa", surface: "rgba(113,113,122,0.12)" };

function offsetPhrase(candidateOffset: number, aeOffset: number): string {
  const diff = aeOffset - candidateOffset;
  if (Math.abs(diff) < 0.01) return `${AE_TIME_ZONE_LABEL} is the same time as this candidate`;
  const rounded = Math.round(Math.abs(diff) * 100) / 100;
  const hoursLabel = rounded === 1 ? "1 hour" : `${rounded} hours`;
  return `${AE_TIME_ZONE_LABEL} is ${hoursLabel} ${diff > 0 ? "ahead of" : "behind"} this candidate`;
}

export function CandidateTimezoneCard({
  candidateName,
  timezone,
  currentLocation,
  marginBottom = 20,
}: {
  candidateName: string;
  timezone: string | null;
  currentLocation: string | null;
  marginBottom?: number;
}) {
  // Re-renders periodically so the displayed clock keeps ticking without a page reload.
  // 30s is plenty for a "what time is it there right now" glance - no need for per-second
  // updates on a staff dashboard.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const nowIso = now.toISOString();
  const tone = timezone ? TONE_KNOWN : TONE_UNKNOWN;

  const candidateTime = timezone ? formatAnyZonedTime(nowIso, timezone) : null;
  const candidateDate = timezone ? formatAnyZonedDateTime(nowIso, timezone) : null;
  const aeTime = formatAnyZonedTime(nowIso, AE_TIME_ZONE);
  const candidateOffset = timezone ? utcOffsetHours(nowIso, timezone) : null;
  const aeOffset = utcOffsetHours(nowIso, AE_TIME_ZONE);
  const comparison = candidateOffset !== null && aeOffset !== null ? offsetPhrase(candidateOffset, aeOffset) : null;

  return (
    <section
      className="card"
      aria-label={`${candidateName} timezone`}
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
            Candidate timezone
          </p>
          <h2 style={{ margin: 0, color: "var(--ink)", fontSize: 21, lineHeight: 1.25, fontWeight: 750 }}>
            {timezone ? "Local time right now" : "Timezone not available"}
          </h2>
          <p style={{ margin: "7px 0 0", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>
            {timezone
              ? comparison ?? "Comparing against Dhaka, Bangladesh."
              : "Add a current location on this candidate's profile to detect their timezone automatically."}
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 11px", border: `1px solid ${tone.accent}55`, borderRadius: 999, color: tone.accent, background: tone.surface, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          <Globe size={15} aria-hidden="true" /> {timezone ?? "Unknown"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 12, marginTop: 18 }}>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: `1px solid ${tone.accent}44`, background: tone.surface }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {candidateName.split(" ")[0]}&rsquo;s time
          </p>
          <div style={{ marginTop: 6, color: tone.accent, fontSize: 30, lineHeight: 1.15, fontWeight: 800 }}>
            {candidateTime ?? "—"}
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>{candidateDate ?? "Updates automatically"}</p>
        </div>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 76%, transparent)" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>Current location</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "var(--ink)", fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
            <MapPin size={18} color={tone.accent} aria-hidden="true" />
            <span>{currentLocation ?? "Not on file"}</span>
          </div>
          <p style={{ margin: "5px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>Used to detect the timezone above</p>
        </div>
        <div style={{ minHeight: 104, padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 76%, transparent)" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 11, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>{AE_TIME_ZONE_LABEL}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "var(--ink)", fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
            <Clock3 size={18} color={tone.accent} aria-hidden="true" />
            <span>{aeTime ?? "—"}</span>
          </div>
          <p style={{ margin: "5px 0 0", color: "var(--ink-soft)", fontSize: 12 }}>Your team&rsquo;s local time, for reference</p>
        </div>
      </div>
    </section>
  );
}
