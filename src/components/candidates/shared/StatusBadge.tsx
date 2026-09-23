"use client";

var STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  replied: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Rejected",
  assigned: "Applied",
  stacked: "Applied",
  in_progress: "Applied",
};

var STATUS_COLORS: Record<string, string> = {
  Applied: "#10b981",
  Screening: "#06b6d4",
  Interview: "#a855f7",
  Offer: "#3b82f6",
  Rejected: "#f43f5e",
};

export function displayStatusGroup(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export default function StatusBadge({ status }: { status: string }) {
  var label = displayStatusGroup(status);
  var color = STATUS_COLORS[label] ?? "#64748b";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        color: color,
        background: color + "18",
        border: "1px solid " + color + "40",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
