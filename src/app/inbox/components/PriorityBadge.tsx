import React from "react";

export interface PriorityBadgeProps {
  needs_reply?: boolean;
  replied_at?: string | null;
  due_at?: string | null;
  ai_category?: string | null;
  level?: string;
  label?: string;
}

export function PriorityBadge({ needs_reply, replied_at, due_at, ai_category, level, label }: PriorityBadgeProps) {
  if (level) {
    if (level === "urgent") return <span className="badge" style={{ backgroundColor: "#fee2e2", color: "#dc2626", border: "1px solid #f87171" }}>{label || "Urgent"}</span>;
    if (level === "high") return <span className="badge" style={{ backgroundColor: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d" }}>{label || "High"}</span>;
    return <span className="badge" style={{ backgroundColor: "#f3f4f6", color: "#4b5563", border: "1px solid #e5e7eb" }}>{label || "Normal"}</span>;
  }

  if (needs_reply && !replied_at) {
    if (due_at) {
      const isOverdue = new Date(due_at) < new Date();
      if (isOverdue) {
        return <span className="badge" style={{ backgroundColor: "#fee2e2", color: "#dc2626", border: "1px solid #f87171" }}>⚠ Urgent — Overdue</span>;
      }
      return <span className="badge" style={{ backgroundColor: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d" }}>↩ Reply by {new Date(due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>;
    }
    return <span className="badge" style={{ backgroundColor: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d" }}>↩ Needs reply</span>;
  }
  if (ai_category === 'interview_invite') {
    return <span className="badge" style={{ backgroundColor: "#dcfce7", color: "#16a34a", border: "1px solid #86efac" }}>📅 Interview invite</span>;
  }
  return null;
}
