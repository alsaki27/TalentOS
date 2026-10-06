"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarDays, GraduationCap, History, RefreshCw, XCircle } from "lucide-react";
import {
  buildScheduleEvents,
  defaultDisplayZone,
  isDisplayZone,
  type DisplayZone,
  type PortalInterview,
  type PortalTrainingAudit,
} from "@/lib/portalSchedule";
import { usePortalPolling } from "./usePortalPolling";
import ScheduleView, { type ScheduleViewMode } from "./ScheduleView";
import TrainingAuditTab from "./TrainingAuditTab";
import type { AgendaTab } from "./ScheduleAgenda";

type PortalTab = "schedule" | "training";

function clockTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Candidate interview center: one live schedule for job interviews, mock
 * interviews, and (later) other meetings, plus the training audit. Both data
 * sources refresh every 15 seconds while the page is open.
 */
export default function CandidatePortalScheduleCenter() {
  const router = useRouter();
  const interviews = usePortalPolling<{ interviews: PortalInterview[] }>("/api/portal/me/interviews");
  const training = usePortalPolling<PortalTrainingAudit>("/api/portal/me/training-audit");

  // `now` is set after mount so server and client render the same first frame.
  const [now, setNow] = useState<Date | null>(null);
  const [tab, setTab] = useState<PortalTab>("schedule");
  const [mode, setMode] = useState<ScheduleViewMode>("week");
  const [agendaTab, setAgendaTab] = useState<AgendaTab>("upcoming");
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [zoneChoice, setZoneChoice] = useState<DisplayZone | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "training") setTab("training");
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // The default zone comes from the interviews only: mock sessions carry no time,
  // so they cannot pick it. Choosing a zone in the toolbar overrides the default.
  const interviewEvents = useMemo(
    () => (now ? buildScheduleEvents(interviews.data?.interviews ?? [], [], now) : []),
    [now, interviews.data],
  );
  const zone: DisplayZone = zoneChoice ?? defaultDisplayZone(interviewEvents);
  const events = useMemo(
    () => (now ? buildScheduleEvents(interviews.data?.interviews ?? [], training.data?.mockSessions ?? [], now, zone) : []),
    [now, interviews.data, training.data, zone],
  );

  const counts = useMemo(() => ({
    upcoming: events.filter((event) => event.bucket === "upcoming").length,
    past: events.filter((event) => event.bucket === "past").length,
    cancelled: events.filter((event) => event.bucket === "cancelled").length,
    mock: events.filter((event) => event.kind === "mock").length,
  }), [events]);

  const updatedAt = [interviews.updatedAt, training.updatedAt]
    .filter((value): value is Date => value !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  function selectTab(next: PortalTab) {
    setTab(next);
    router.replace(next === "training" ? "/portal/interviews?tab=training" : "/portal/interviews", { scroll: false });
  }

  function openFromStat(key: "upcoming" | "past" | "cancelled" | "mock") {
    if (key === "mock") { selectTab("training"); return; }
    setAgendaTab(key);
    setMode("agenda");
    selectTab("schedule");
  }

  const initialLoading = !now || (interviews.loading && !interviews.data);
  const initialError = !interviews.data && interviews.error ? interviews.error : "";

  return (
    <div className="psc">
      <div className="psc-headrow">
        <div>
          <div className="portal-eyebrow">Interview center</div>
          <h2 className="portal-section-heading-title">Your interview schedule</h2>
          <p className="portal-greeting-sub">
            Each interview shows the time it was scheduled in. Changes appear here automatically.
          </p>
        </div>
        <div className="psc-live" role="status" aria-live="polite">
          {updatedAt ? (
            <>
              <span className="psc-live-dot" aria-hidden="true" />
              Live · updated {clockTime(updatedAt)}
            </>
          ) : (
            <>
              <RefreshCw size={12} aria-hidden="true" /> Connecting…
            </>
          )}
        </div>
      </div>

      {interviews.error && interviews.data && <div className="psc-error-banner">{interviews.error}</div>}

      <div className="psc-stats" role="group" aria-label="Schedule summary">
        <button type="button" className="psc-stat psc-stat-upcoming" onClick={() => openFromStat("upcoming")}>
          <span className="psc-stat-icon"><CalendarClock size={16} /></span>
          <div className="psc-stat-text"><strong>{counts.upcoming}</strong><span>Upcoming</span></div>
        </button>
        <button type="button" className="psc-stat psc-stat-past" onClick={() => openFromStat("past")}>
          <span className="psc-stat-icon"><History size={16} /></span>
          <div className="psc-stat-text"><strong>{counts.past}</strong><span>Past</span></div>
        </button>
        <button type="button" className="psc-stat psc-stat-cancelled" onClick={() => openFromStat("cancelled")}>
          <span className="psc-stat-icon"><XCircle size={16} /></span>
          <div className="psc-stat-text"><strong>{counts.cancelled}</strong><span>Cancelled</span></div>
        </button>
        <button type="button" className="psc-stat psc-stat-mock" onClick={() => openFromStat("mock")}>
          <span className="psc-stat-icon"><GraduationCap size={16} /></span>
          <div className="psc-stat-text"><strong>{counts.mock}</strong><span>Mock sessions</span></div>
        </button>
      </div>

      <div className="portal-tab-list" role="tablist" aria-label="Interview sections">
        <button type="button" role="tab" aria-selected={tab === "schedule"} className={`portal-tab ${tab === "schedule" ? "portal-tab-active" : ""}`} onClick={() => selectTab("schedule")}>
          <CalendarDays size={14} /> Schedule
        </button>
        <button type="button" role="tab" aria-selected={tab === "training"} className={`portal-tab ${tab === "training" ? "portal-tab-active" : ""}`} onClick={() => selectTab("training")}>
          <GraduationCap size={14} /> Training audit
        </button>
      </div>

      <div className="psc-tabpanel" role="tabpanel">
        {tab === "schedule" ? (
          initialLoading ? (
            <div className="portal-skeleton" style={{ height: 360 }} />
          ) : initialError ? (
            <p className="portal-error">{initialError}</p>
          ) : now ? (
            <ScheduleView
              events={events}
              now={now}
              zone={zone}
              onZoneChange={(next) => { if (isDisplayZone(next)) setZoneChoice(next); }}
              anchorKey={anchorKey}
              onAnchorChange={setAnchorKey}
              mode={mode}
              onModeChange={setMode}
              agendaTab={agendaTab}
              onAgendaTabChange={setAgendaTab}
            />
          ) : null
        ) : (
          <TrainingAuditTab audit={training.data} loading={training.loading} error={training.error} />
        )}
      </div>

    </div>
  );
}
