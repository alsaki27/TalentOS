"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Globe, List } from "lucide-react";
import { INTERVIEW_TIME_ZONES, zonedDateKey } from "@/lib/easternTime";
import {
  addDaysToKey,
  formatWeekRange,
  localDateKey,
  weekKeys,
  type DisplayZone,
  type ScheduleEvent,
} from "@/lib/portalSchedule";
import ScheduleAgenda, { type AgendaTab } from "./ScheduleAgenda";
import ScheduleWeekCalendar from "./ScheduleWeekCalendar";

export type ScheduleViewMode = "week" | "agenda";

interface Props {
  events: ScheduleEvent[];
  now: Date;
  zone: DisplayZone;
  onZoneChange: (zone: DisplayZone) => void;
  /** null means "the week containing today". */
  anchorKey: string | null;
  onAnchorChange: (anchorKey: string | null) => void;
  mode: ScheduleViewMode;
  onModeChange: (mode: ScheduleViewMode) => void;
  agendaTab: AgendaTab;
  onAgendaTabChange: (tab: AgendaTab) => void;
}

export default function ScheduleView({
  events,
  now,
  zone,
  onZoneChange,
  anchorKey,
  onAnchorChange,
  mode,
  onModeChange,
  agendaTab,
  onAgendaTabChange,
}: Props) {
  const todayKey = zonedDateKey(now.toISOString(), zone) ?? localDateKey(now);
  const anchor = anchorKey ?? todayKey;
  const days = weekKeys(anchor);
  const unscheduledCount = events.filter((event) => event.bucket === "unscheduled").length;

  return (
    <div>
      <div className="psc-toolbar">
        <div className="psc-toolbar-left">
          <button type="button" className="psc-icon-btn" onClick={() => onAnchorChange(addDaysToKey(anchor, -7))} aria-label="Previous week">
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="psc-today-btn" onClick={() => onAnchorChange(null)}>Today</button>
          <button type="button" className="psc-icon-btn" onClick={() => onAnchorChange(addDaysToKey(anchor, 7))} aria-label="Next week">
            <ChevronRight size={15} />
          </button>
          <span className="psc-range">{formatWeekRange(days)}</span>
        </div>
        <div className="psc-toolbar-right">
          <label className="psc-zone-select">
            <Globe size={13} aria-hidden="true" />
            <select value={zone} onChange={(event) => onZoneChange(event.target.value as DisplayZone)} aria-label="Calendar time zone">
              {INTERVIEW_TIME_ZONES.map((item) => (
                <option key={item.value} value={item.value}>{item.shortName} · {item.label}</option>
              ))}
            </select>
          </label>
          <div className="psc-view-toggle" role="group" aria-label="View">
            <button type="button" className={mode === "week" ? "psc-view-active" : ""} aria-pressed={mode === "week"} onClick={() => onModeChange("week")}>
              <CalendarDays size={13} /> Week
            </button>
            <button type="button" className={mode === "agenda" ? "psc-view-active" : ""} aria-pressed={mode === "agenda"} onClick={() => onModeChange("agenda")}>
              <List size={13} /> Agenda
            </button>
          </div>
        </div>
      </div>

      {mode === "week" ? (
        <>
          {unscheduledCount > 0 && (
            <p className="psc-unscheduled-note">
              {unscheduledCount} interview{unscheduledCount === 1 ? " is" : "s are"} waiting for a date.{" "}
              <button type="button" className="psc-link-button" onClick={() => onModeChange("agenda")}>View in agenda</button>
            </p>
          )}
          <ScheduleWeekCalendar events={events} days={days} zone={zone} now={now} />
          <p className="psc-unscheduled-note">
            Grid times are in {INTERVIEW_TIME_ZONES.find((item) => item.value === zone)?.label ?? zone}. Each card's tooltip shows the zone it was scheduled in.
          </p>
        </>
      ) : (
        <ScheduleAgenda events={events} zone={zone} now={now} tab={agendaTab} onTabChange={onAgendaTabChange} />
      )}
    </div>
  );
}
