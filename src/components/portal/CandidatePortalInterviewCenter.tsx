"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Video, MapPin, Users, CalendarX2 } from "lucide-react";

interface Interview {
  id: string | null;
  application_id: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  duration_minutes: number | null;
  status: "upcoming" | "completed" | "cancelled" | "not_scheduled";
  meeting_link: string | null;
  panel: string[];
  visible_updates: { id: string; body: string; author: string; created_at: string | null }[];
}

function formatDateTime(value: string | null) {
  if (!value) return "Date and time to be confirmed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date and time to be confirmed";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function statusLabel(status: Interview["status"]) {
  return status === "upcoming" ? "Upcoming" : status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "Not scheduled";
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function MiniCalendar({ interviews }: { interviews: Interview[] }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const eventDays = useMemo(() => {
    const days = new Set<number>();
    for (const interview of interviews) {
      if (!interview.scheduled_at) continue;
      const date = new Date(interview.scheduled_at);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() === year && date.getMonth() === month) days.add(date.getDate());
    }
    return days;
  }, [interviews, year, month]);

  if (eventDays.size === 0) return null;

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="portal-mini-calendar">
      {DOW.map((d, i) => <div key={i} className="portal-mini-calendar-dow">{d}</div>)}
      {cells.map((day, i) => {
        if (day === null) return <div key={i} />;
        const isToday = day === today.getDate();
        const hasEvent = eventDays.has(day);
        return (
          <div
            key={i}
            className={`portal-mini-calendar-day ${isToday ? "portal-mini-calendar-day-today" : ""} ${hasEvent ? "portal-mini-calendar-day-event" : ""}`}
          >
            {day}
          </div>
        );
      })}
    </div>
  );
}

export default function CandidatePortalInterviewCenter() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/portal/me/interviews", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (!controller.signal.aborted && result) setInterviews(result.interviews || []); })
      .catch((requestError) => { if (!controller.signal.aborted && requestError?.name !== "AbortError") setError("Interview center could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "your local timezone", []);
  const visible = interviews.filter((interview) => tab === "upcoming" ? interview.status === "upcoming" || interview.status === "not_scheduled" : interview.status === "completed" || interview.status === "cancelled");

  return <section className="portal-section" aria-labelledby="interview-center-heading">
    <div className="portal-section-heading"><div><div className="portal-eyebrow">Interview center</div><h2 id="interview-center-heading" className="portal-section-heading-title">Your interview schedule</h2><p className="portal-greeting-sub">Times are shown in {timezone}. Private staff notes are never shown here.</p></div><span className="portal-count-badge">{interviews.filter((item) => item.status === "upcoming").length}</span></div>
    {!loading && <MiniCalendar interviews={interviews} />}
    <div className="portal-tab-list" role="tablist" aria-label="Interview history tabs"><button className={`portal-tab ${tab === "upcoming" ? "portal-tab-active" : ""}`} role="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>Upcoming</button><button className={`portal-tab ${tab === "history" ? "portal-tab-active" : ""}`} role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History</button></div>
    {loading ? <div className="portal-skeleton" style={{ height: 90 }} /> : error ? <p className="portal-error">{error}</p> : visible.length === 0 ? <div className="portal-empty portal-action-empty"><div className="portal-empty-icon"><CalendarX2 size={26} /></div><strong>{tab === "upcoming" ? "No upcoming interviews." : "No interview history yet."}</strong><span>Interview details and meeting links will appear here when the team records them.</span></div> : <div className="portal-interview-center-list">{visible.map((interview) => <article className="portal-interview-center-card" key={`${interview.application_id}:${interview.id || "unscheduled"}`}><div className="portal-interview-center-main"><div className="portal-interview-center-title"><strong>{interview.round_name}</strong><span className={`portal-interview-status portal-interview-status-${interview.status}`}>{statusLabel(interview.status)}</span></div><h3>{interview.job_title}</h3><p>{interview.company_name || "Company unavailable"}</p><p className="portal-interview-time"><CalendarClock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{formatDateTime(interview.scheduled_at)}{interview.duration_minutes ? ` · ${interview.duration_minutes} min` : ""}</p>{interview.location && <p><MapPin size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{interview.location}</p>}{interview.panel.length > 0 && <p><Users size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{interview.panel.join(", ")}</p>}{interview.visible_updates.length > 0 && <div className="portal-interview-updates"><strong>Team update</strong><p>{interview.visible_updates[0].body}</p><span>{interview.visible_updates[0].author} · {formatDate(interview.visible_updates[0].created_at)}</span></div>}</div>{interview.meeting_link && interview.status === "upcoming" && <a className="portal-btn portal-btn-primary portal-btn-small" href={interview.meeting_link} target="_blank" rel="noreferrer"><Video size={13} style={{ marginRight: 4 }} />Open meeting</a>}</article>)}</div>}
  </section>;
}
