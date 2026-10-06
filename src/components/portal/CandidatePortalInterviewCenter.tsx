"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, MapPin, Video, Users, GraduationCap, RefreshCw } from "lucide-react";
import { formatZonedDateTime } from "@/lib/easternTime";

interface CandidateInterview {
  id: string | null;
  application_id: string;
  job_id: string | null;
  job_title: string;
  company_name: string | null;
  location: string | null;
  job_location: string | null;
  job_posting_url: string | null;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  time_zone: string;
  duration_minutes: number | null;
  status: "upcoming" | "completed" | "cancelled" | "not_scheduled";
  interview_status: string | null;
  interview_format: "online" | "onsite" | null;
  meeting_link: string | null;
  panel: string[];
  visible_updates: { id: string; body: string; author: string; created_at: string | null }[];
}

interface TrainingAudit {
  linked: boolean;
  student: { domain: string | null; target_role: string | null; progress: number; synced_at: string | null } | null;
  mockInterviewCount: number;
  mockSessions: {
    id: string;
    session_date: string;
    target_role: string | null;
    round_type: string | null;
    overall_score: number | null;
    overall_score_max: number | null;
    feedback_summary: string | null;
    strengths_noted: string | null;
    areas_for_improvement: string | null;
  }[];
}

type InterviewTab = "upcoming" | "past" | "cancelled";

function safeDate(value: string | null, withTime = false, timeZone?: string) {
  if (!value) return withTime ? "Date and time to be confirmed" : "Date to be confirmed";
  const isDateOnly = !withTime && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return withTime ? "Date and time to be confirmed" : "Date to be confirmed";
  if (withTime) return formatZonedDateTime(value, timeZone);
  // dateStyle/timeStyle cannot be combined with timeZoneName (or any other
  // component option) per the Intl.DateTimeFormat spec - the constructor
  // throws "Invalid option : option" for every real (non-null) date the
  // instant this runs, which is exactly what crashed this page. Spell the
  // same "medium date, short time, short zone name" output out as explicit
  // component options instead, which mix freely.
  return new Intl.DateTimeFormat(undefined, withTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function interviewBucket(interview: CandidateInterview): InterviewTab | "unscheduled" {
  const status = String(interview.interview_status || "scheduled").toLowerCase();
  if (status === "cancelled" || interview.status === "cancelled") return "cancelled";
  if (!interview.scheduled_at || Number.isNaN(new Date(interview.scheduled_at).getTime())) return "unscheduled";
  if (status === "completed" || interview.status === "completed" || new Date(interview.scheduled_at).getTime() <= Date.now()) return "past";
  return "upcoming";
}

function InterviewCard({ interview, bucket }: { interview: CandidateInterview; bucket: InterviewTab | "unscheduled" }) {
  const label = bucket === "upcoming" ? "Upcoming" : bucket === "past" ? "Past" : bucket === "cancelled" ? "Cancelled" : "Date to be confirmed";
  // Every interview links to the application details page, which already shows
  // the job, progress, and interviews for that application.
  const jobDetailsHref = `/portal/applications/${interview.application_id}`;
  const visibleUpdate = interview.visible_updates[0];

  return (
    <article className="portal-interview-center-card">
      <div className="portal-interview-center-main" style={{ flex: 1, minWidth: 0 }}>
        <div className="portal-interview-center-title">
          <strong>{interview.round_name}{interview.round_number > 1 ? ` · Round ${interview.round_number}` : ""}</strong>
          <span className={`portal-interview-status portal-interview-status-${bucket === "past" ? "completed" : bucket === "unscheduled" ? "not_scheduled" : bucket}`}>{label}</span>
        </div>
        <h3><a href={jobDetailsHref} style={{ color: "inherit", textDecoration: "none" }}>{interview.job_title}</a></h3>
        <p>{interview.company_name || "Company unavailable"}{interview.job_location ? ` · ${interview.job_location}` : ""}</p>
        <p className="portal-interview-time"><CalendarClock size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{safeDate(interview.scheduled_at, true, interview.time_zone)}{interview.duration_minutes ? ` · ${interview.duration_minutes} min` : ""}</p>
        <p>{interview.interview_format ? `Format: ${interview.interview_format === "online" ? "Online" : "Onsite"}` : "Format: Not provided"}</p>
        {interview.location && <p><MapPin size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Interview location: {interview.location}</p>}
        {interview.panel.length > 0 && <p><Users size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Interviewers: {interview.panel.join(", ")}</p>}
        <div className="portal-interview-center-actions" role="group" aria-label="Related job links">
          <a className="portal-btn portal-btn-secondary portal-btn-small" href={jobDetailsHref}>View job details</a>
          {interview.job_posting_url && <a className="portal-btn portal-btn-secondary portal-btn-small" href={interview.job_posting_url} target="_blank" rel="noreferrer"><ExternalLink size={12} style={{ marginRight: 4 }} />Original posting</a>}
        </div>
        {visibleUpdate && <div className="portal-interview-updates"><strong>Team update</strong><p>{visibleUpdate.body}</p><span>{visibleUpdate.author} · {safeDate(visibleUpdate.created_at)}</span></div>}
      </div>
      {bucket === "upcoming" && interview.meeting_link && <a className="portal-btn portal-btn-primary portal-btn-small" href={interview.meeting_link} target="_blank" rel="noreferrer"><Video size={13} style={{ marginRight: 4 }} />Join interview</a>}
    </article>
  );
}

function TrainingAuditCard({ audit, loading, error }: { audit: TrainingAudit | null; loading: boolean; error: string }) {
  const student = audit?.student;
  const progress = Math.max(0, Math.min(100, Number(student?.progress ?? 0)));

  return (
    <section className="portal-card" style={{ marginTop: 18, padding: 20 }}>
      <div className="portal-section-heading" style={{ marginBottom: 14 }}>
        <div><div className="portal-eyebrow">Training audit</div><h2 className="portal-section-heading-title">Your training progress</h2><p className="portal-greeting-sub">Course progress and mock interview records from your training profile.</p></div>
        <GraduationCap size={22} />
      </div>
      {loading && !audit ? <div className="portal-skeleton" style={{ height: 90 }} /> : error ? <p className="portal-error">{error}</p> : student ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <div className="portal-interview-center-card" style={{ display: "block" }}>
              <strong>Course completion</strong>
              <p style={{ fontSize: 22, fontWeight: 800, color: "var(--p-navy)", margin: "8px 0" }}>{progress}%</p>
              <div role="progressbar" aria-label="Course completion" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 7, borderRadius: 99, background: "var(--p-border)", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: "var(--p-coral)", borderRadius: 99 }} /></div>
            </div>
            <div className="portal-interview-center-card" style={{ display: "block" }}><strong>Mock interviews</strong><p style={{ fontSize: 22, fontWeight: 800, color: "var(--p-navy)", margin: "8px 0 0" }}>{audit?.mockInterviewCount ?? 0}</p><p>recorded session{audit?.mockInterviewCount === 1 ? "" : "s"}</p></div>
            <div className="portal-interview-center-card" style={{ display: "block" }}><strong>Domain / track</strong><p style={{ color: "var(--p-ink)", fontWeight: 700, margin: "8px 0 0" }}>{student.domain || student.target_role || "Not set"}</p></div>
          </div>
          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Mock interview history</h3>
            {audit?.mockSessions.length ? <div className="portal-interview-center-list">{audit.mockSessions.map((session) => (
              <article className="portal-interview-center-card" key={session.id}>
                <div style={{ flex: 1 }}>
                  <strong>{session.round_type || "Mock interview"}</strong>
                  <p>{safeDate(session.session_date)}{session.target_role ? ` · ${session.target_role}` : ""}</p>
                  {(session.feedback_summary || session.strengths_noted || session.areas_for_improvement) && <details style={{ marginTop: 9 }}>
                    <summary style={{ cursor: "pointer", color: "var(--p-navy)", fontSize: 12, fontWeight: 700 }}>View feedback</summary>
                    {session.feedback_summary && <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{session.feedback_summary}</p>}
                    {session.strengths_noted && <p style={{ whiteSpace: "pre-wrap" }}><strong>Strengths:</strong> {session.strengths_noted}</p>}
                    {session.areas_for_improvement && <p style={{ whiteSpace: "pre-wrap" }}><strong>Areas to improve:</strong> {session.areas_for_improvement}</p>}
                  </details>}
                </div>
                <strong>{session.overall_score == null ? "Score not recorded" : `${session.overall_score}${session.overall_score_max ? ` / ${session.overall_score_max}` : ""}`}</strong>
              </article>
            ))}</div> : <p className="portal-greeting-sub">No mock interview sessions recorded yet.</p>}
          </div>
        </>
      ) : <p className="portal-greeting-sub">Training audit information is not available yet.</p>}
    </section>
  );
}

export default function CandidatePortalInterviewCenter() {
  const router = useRouter();
  const [interviews, setInterviews] = useState<CandidateInterview[]>([]);
  const [audit, setAudit] = useState<TrainingAudit | null>(null);
  const [tab, setTab] = useState<InterviewTab>("upcoming");
  const [loading, setLoading] = useState(true);
  const [interviewError, setInterviewError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    async function refresh() {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      const [interviewResult, auditResult] = await Promise.allSettled([
        fetch("/api/portal/me/interviews", { cache: "no-store" }),
        fetch("/api/portal/me/training-audit", { cache: "no-store" }),
      ]);

      if (disposed) { inFlight = false; return; }

      if (interviewResult.status === "fulfilled") {
        const response = interviewResult.value;
        if (response.status === 401) router.push("/portal/login");
        else if (response.ok) {
          const result = await response.json().catch(() => null);
          if (result && !disposed) { setInterviews(result.interviews || []); setInterviewError(""); }
          else if (!result) setInterviewError("Interview schedule could not be loaded.");
        } else setInterviewError("Interview schedule could not be loaded.");
      } else setInterviewError("Interview schedule could not be loaded.");

      if (auditResult.status === "fulfilled") {
        const response = auditResult.value;
        if (response.status === 401) router.push("/portal/login");
        else if (response.ok) {
          const result = await response.json().catch(() => null);
          if (result && !disposed) { setAudit(result); setAuditError(""); }
          else if (!result) setAuditError("Training audit information could not be loaded.");
        } else setAuditError("Training audit information could not be loaded.");
      } else setAuditError("Training audit information could not be loaded.");

      if (!disposed) {
        setLastUpdated(new Date());
        setLoading(false);
        setAuditLoading(false);
      }
      inFlight = false;
    }

    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  const classified = useMemo(() => interviews.map((interview) => ({ interview, bucket: interviewBucket(interview) })), [interviews, lastUpdated]);
  const upcoming = classified.filter((item) => item.bucket === "upcoming");
  const past = classified.filter((item) => item.bucket === "past");
  const cancelled = classified.filter((item) => item.bucket === "cancelled");
  const unscheduled = classified.filter((item) => item.bucket === "unscheduled");
  const visible = tab === "upcoming" ? upcoming : tab === "past" ? past : cancelled;

  return (
    <div>
      <section className="portal-section" aria-labelledby="interview-center-heading">
        <div className="portal-section-heading"><div><div className="portal-eyebrow">Interview center</div><h2 id="interview-center-heading" className="portal-section-heading-title">Your interview schedule</h2><p className="portal-greeting-sub">Times are shown in the timezone selected when the interview was scheduled. Schedule changes refresh every 15 seconds while this page is open.</p></div><div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-ink-soft)", fontSize: 11 }}><RefreshCw size={13} />{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading"}</div></div>
        <div className="portal-tab-list" role="tablist" aria-label="Interview schedule filter">
          {(["upcoming", "past", "cancelled"] as const).map((key) => <button key={key} className={`portal-tab ${tab === key ? "portal-tab-active" : ""}`} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{key === "upcoming" ? `Upcoming (${upcoming.length})` : key === "past" ? `Past (${past.length})` : `Cancelled (${cancelled.length})`}</button>)}
        </div>
        {unscheduled.length > 0 && <div style={{ margin: "14px 0" }}><h3 style={{ fontSize: 13 }}>Waiting for a date</h3><div className="portal-interview-center-list">{unscheduled.map(({ interview }) => <InterviewCard key={`${interview.application_id}:${interview.id || "unscheduled"}`} interview={interview} bucket="unscheduled" />)}</div></div>}
        {loading ? <div className="portal-skeleton" style={{ height: 110 }} /> : interviewError ? <p className="portal-error">{interviewError}</p> : visible.length === 0 ? <div className="portal-empty portal-action-empty"><div className="portal-empty-icon"><CalendarClock size={26} /></div><strong>{tab === "upcoming" ? "No upcoming interviews." : tab === "past" ? "No past interviews yet." : "No cancelled interviews."}</strong><span>Interview details appear here when the team records them.</span></div> : <div className="portal-interview-center-list">{visible.map(({ interview, bucket }) => <InterviewCard key={`${interview.application_id}:${interview.id || "unscheduled"}`} interview={interview} bucket={bucket} />)}</div>}
      </section>
      <TrainingAuditCard audit={audit} loading={auditLoading} error={auditError} />
    </div>
  );
}
