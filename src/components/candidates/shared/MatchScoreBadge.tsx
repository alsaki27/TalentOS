"use client";

function scoreMeta(score: number | null | undefined): { label: string; color: string } {
  if (score == null) return { label: "N/A", color: "#64748b" };
  if (score >= 85) return { label: "Strong", color: "#10b981" };
  if (score >= 70) return { label: "Good", color: "#06b6d4" };
  if (score >= 60) return { label: "Review", color: "#f59e0b" };
  return { label: "Excluded", color: "#f43f5e" };
}

export default function MatchScoreBadge({ score }: { score: number | null | undefined }) {
  var meta = scoreMeta(score);
  var display = score != null ? score + "%" : "N/A";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-mono, monospace)",
        color: meta.color,
        background: meta.color + "15",
        border: "1px solid " + meta.color + "35",
        whiteSpace: "nowrap",
      }}
      title={meta.label}
    >
      {display}
    </span>
  );
}
