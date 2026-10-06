"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, CalendarClock, CalendarDays, Clock3, GraduationCap, History, MapPin, Users, Video, XCircle, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { EASTERN_TIME_ZONE, zonedDateKey } from "@/lib/easternTime";
import {
  eventDayKey,
  eventSortValue,
  formatClock,
  formatDayHeading,
  zoneShortName,
  type DisplayZone,
  type ScheduleBucket,
  type ScheduleEvent,
  type ScheduleKind,
} from "@/lib/portalSchedule";

export type AgendaTab = "upcoming" | "past" | "cancelled";

const AGENDA_TABS: { key: AgendaTab; label: string; icon: LucideIcon; empty: string }[] = [
  { key: "upcoming", label: "Upcoming", icon: CalendarClock, empty: "Nothing upcoming. New interviews and mock sessions appear here as the team schedules them." },
  { key: "past", label: "Past", icon: History, empty: "No past interviews or mock sessions yet." },
  { key: "cancelled", label: "Cancelled", icon: XCircle, empty: "No cancelled interviews." },
];

const KIND_LABEL: Record<ScheduleKind, string> = { interview: "Interview", mock: "Mock interview", meeting: "Meeting" };
const KIND_ICON: Record<ScheduleKind, LucideIcon> = { interview: CalendarClock, mock: GraduationCap, meeting: CalendarDays };
const STATUS_LABEL: Record<ScheduleBucket, string> = { upcoming: "Upcoming", past: "Completed", cancelled: "Cancelled", unscheduled: "Date to be confirmed" };
const FORMAT_LABEL = { online: "Online", onsite: "Onsite" } as const;

export function countAgendaTabs(events: ScheduleEvent[]): Record<AgendaTab, number> {
  return {
    upcoming: events.filter((event) => event.bucket === "upcoming").length,
    past: events.filter((event) => event.bucket === "past").length,
    cancelled: events.filter((event) => event.bucket === "cancelled").length,
  };
}

function AgendaCard({ event }: { event: ScheduleEvent }) {
  const KindIcon = KIND_ICON[event.kind];
  const FormatIcon = event.format === "onsite" ? Building2 : Video;
  return (
    <article className="psc-agenda-item">
      <div className="psc-agenda-time">
        {event.startsAt ? (
          <>
            <strong>{formatClock(event.startsAt, event.timeZone)}</strong>
            <span>{zoneShortName(event.timeZone ?? EASTERN_TIME_ZONE, new Date(event.startsAt))}</span>
          </>
        ) : (
          <>
            <strong>{event.dateKey ? "All day" : "TBC"}</strong>
            <span>{event.kind === "mock" ? "Mock" : "Pending"}</span>
          </>
        )}
      </div>
      <div className="psc-agenda-body">
        <div className="psc-agenda-top">
          <span className={`psc-kind psc-kind-${event.kind}`}><KindIcon size={11} />{KIND_LABEL[event.kind]}</span>
          <span className={`psc-status psc-status-${event.bucket}`}>{STATUS_LABEL[event.bucket]}</span>
        </div>
        <h4>{event.title}</h4>
        <p>{event.subtitle}</p>
        <div className="psc-agenda-meta">
          {event.durationMinutes && <span><Clock3 size={12} />{event.durationMinutes} min</span>}
          {event.format && <span><FormatIcon size={12} />{FORMAT_LABEL[event.format]}</span>}
          {event.location && <span><MapPin size={12} />{event.location}</span>}
          {event.panel.length > 0 && <span><Users size={12} />{event.panel.join(", ")}</span>}
        </div>
      </div>
      <div className="psc-agenda-actions">
        <Link className="portal-btn portal-btn-secondary portal-btn-small" href={event.href} aria-label={`Details: ${event.title}`}>
          <ArrowUpRight size={13} /> Details
        </Link>
        {event.bucket === "upcoming" && event.meetingLink && (
          <a className="portal-btn portal-btn-primary portal-btn-small" href={event.meetingLink} target="_blank" rel="noreferrer">
            <Video size={13} /> Join
          </a>
        )}
      </div>
    </article>
  );
}

interface Props {
  events: ScheduleEvent[];
  zone: DisplayZone;
  now: Date;
  tab: AgendaTab;
  onTabChange: (tab: AgendaTab) => void;
}

/**
 * Agenda list. Days follow the display zone, the same reference the week grid
 * uses. Each card shows the time in the zone that interview was scheduled in,
 * with that zone's abbreviation, so a candidate always sees the interviewer's time.
 */
export default function ScheduleAgenda({ events, zone, now, tab, onTabChange }: Props) {
  const counts = useMemo(() => countAgendaTabs(events), [events]);
  const unscheduled = useMemo(() => events.filter((event) => event.bucket === "unscheduled"), [events]);
  const todayKey = zonedDateKey(now.toISOString(), zone);

  const groups = useMemo(() => {
    const list = events
      .filter((event) => event.bucket === tab)
      .sort((left, right) => (tab === "past" ? eventSortValue(right) - eventSortValue(left) : eventSortValue(left) - eventSortValue(right)));
    const byDay = new Map<string, ScheduleEvent[]>();
    for (const event of list) {
      const key = eventDayKey(event, zone) ?? "undated";
      byDay.set(key, [...(byDay.get(key) ?? []), event]);
    }
    return Array.from(byDay.entries());
  }, [events, tab, zone]);

  const activeTab = AGENDA_TABS.find((item) => item.key === tab) ?? AGENDA_TABS[0];

  return (
    <div>
      <div className="psc-agenda-tabs" role="tablist" aria-label="Agenda filter">
        {AGENDA_TABS.map((item) => {
          const Icon = item.icon;
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`psc-agenda-tab ${active ? "psc-agenda-tab-active" : ""}`}
              onClick={() => onTabChange(item.key)}
            >
              <Icon size={13} /> {item.label} ({counts[item.key]})
            </button>
          );
        })}
      </div>

      {tab === "upcoming" && unscheduled.length > 0 && (
        <section className="psc-agenda-day" aria-label="Waiting for a date">
          <div className="psc-agenda-day-head"><h3>Waiting for a date</h3></div>
          <div className="psc-agenda-list">
            {unscheduled.map((event) => <AgendaCard key={event.key} event={event} />)}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <div className="psc-empty">{activeTab.empty}</div>
      ) : (
        groups.map(([dayKey, dayEvents]) => (
          <section key={dayKey} className="psc-agenda-day" aria-label={dayKey === "undated" ? "Undated" : formatDayHeading(dayKey)}>
            <div className="psc-agenda-day-head">
              <h3>{dayKey === "undated" ? "Undated" : formatDayHeading(dayKey)}</h3>
              {dayKey === todayKey && <span className="psc-today-pill">Today</span>}
            </div>
            <div className="psc-agenda-list">
              {dayEvents.map((event) => <AgendaCard key={event.key} event={event} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
