"use client";

import Link from "next/link";

interface InterviewPanelMember {
  id: string;
  interviewer_id: string;
  role: string;
  status: string;
  feedback_submitted: boolean;
  profile?: {
    user_id?: string;
    display_name?: string | null;
    email?: string | null;
  } | null;
}

interface Interview {
  id: string;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  duration_minutes: number;
  status: string;
  location: string | null;
  meeting_link: string | null;
  applications?: {
    candidate_id: string;
    job_id: string;
    candidates: { id: string; name: string; email: string | null } | null;
    jobs: { id: string; title: string; company: string | null } | null;
  } | null;
  panel?: InterviewPanelMember[];
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "scheduled": return "badge-scheduled";
    case "completed": return "badge-offer";
    case "cancelled": return "badge-closed";
    case "no_show": return "badge-rejected";
    case "in_progress": return "badge-in_progress";
    default: return "badge";
  }
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export default function InterviewCard({ interview }: { interview: Interview }) {
  const candidate = interview.applications?.candidates;
  const job = interview.applications?.jobs;
  const time = interview.scheduled_at
    ? new Date(interview.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
  const date = interview.scheduled_at
    ? new Date(interview.scheduled_at).toLocaleDateString()
    : "—";

  return (
    <div className="card" style={{ cursor: "pointer" }}>
      <Link href={`/interviews/${interview.id}`} style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>
              {candidate?.name ?? "Unknown Candidate"}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {job?.title ?? "—"} {job?.company ? `• ${job.company}` : ""}
            </div>
          </div>
          <span className={`badge ${statusBadgeClass(interview.status)}`}>
            {interview.status}
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
          <span>{interview.round_name}</span>
          <span>{date}</span>
          <span>{time}</span>
          <span>{interview.duration_minutes} min</span>
        </div>

        {interview.panel && interview.panel.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {interview.panel.slice(0, 4).map((p) => (
              <span
                key={p.id}
                className="avatar-circle"
                title={p.profile?.display_name || p.profile?.email || p.interviewer_id}
              >
                {initials(p.profile?.display_name || p.profile?.email)}
              </span>
            ))}
            {interview.panel.length > 4 && (
              <span className="avatar-circle" style={{ background: "var(--bg)", color: "var(--ink-soft)" }}>
                +{interview.panel.length - 4}
              </span>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}
