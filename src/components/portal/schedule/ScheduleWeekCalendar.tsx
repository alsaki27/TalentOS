"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { zonedDateKey } from "@/lib/easternTime";
import {
  clampEndMinute,
  dayOfMonth,
  formatClock,
  formatWeekday,
  gridHourRange,
  layoutDayColumns,
  zoneShortName,
  zonedMinuteOfDay,
  type DisplayZone,
  type ScheduleEvent,
  type TimedPlacement,
} from "@/lib/portalSchedule";

// Must match --psc-hour in portal-schedule.css.
const HOUR_PX = 56;
const MINUTE_PX = HOUR_PX / 60;
const MIN_BLOCK_PX = 30;

const BLOCK_KIND_CLASS: Record<ScheduleEvent["kind"], string> = {
  interview: "psc-block-interview",
  mock: "psc-block-mock",
  meeting: "psc-block-meeting",
};

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

interface Props {
  events: ScheduleEvent[];
  days: string[];
  zone: DisplayZone;
  now: Date;
}

/**
 * Teams-style week grid. Every timed item is placed by its real instant in the
 * display zone, so two interviews scheduled in different zones line up
 * correctly against one time axis. The card tooltip names each interview's own
 * saved zone. Date-only mock sessions sit in the all-day row.
 */
export default function ScheduleWeekCalendar({ events, days, zone, now }: Props) {
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const todayKey = zonedDateKey(clock.toISOString(), zone);
  const nowMinute = zonedMinuteOfDay(clock.toISOString(), zone);

  const layout = useMemo(() => {
    const dayIndex = new Map(days.map((key, index) => [key, index]));
    const allDay: ScheduleEvent[][] = days.map(() => []);
    const timed: TimedPlacement<ScheduleEvent>[][] = days.map(() => []);

    for (const event of events) {
      if (event.dateKey) {
        const index = dayIndex.get(event.dateKey);
        if (index !== undefined) allDay[index].push(event);
        continue;
      }
      if (!event.startsAt) continue;
      const key = zonedDateKey(event.startsAt, zone);
      const index = key ? dayIndex.get(key) : undefined;
      const startMinute = zonedMinuteOfDay(event.startsAt, zone);
      if (index === undefined || startMinute === null) continue;
      timed[index].push({ item: event, startMinute, endMinute: clampEndMinute(startMinute, event.durationMinutes) });
    }

    const { startHour, endHour } = gridHourRange(timed.flat());
    return {
      allDay,
      startHour,
      endHour,
      placed: timed.map((placements) => layoutDayColumns(placements)),
    };
  }, [events, days, zone]);

  const { allDay, startHour, endHour, placed } = layout;
  const bodyHeight = (endHour - startHour) * HOUR_PX;
  const gridStartMinute = startHour * 60;
  const todayIndex = todayKey ? days.indexOf(todayKey) : -1;
  const nowLineTop = nowMinute !== null && todayIndex >= 0 && nowMinute >= gridStartMinute && nowMinute <= endHour * 60
    ? (nowMinute - gridStartMinute) * MINUTE_PX
    : null;

  return (
    <div className="psc-week-scroll" role="region" aria-label="Week calendar">
      <div className="psc-week-grid" style={{ ["--psc-hour" as string]: `${HOUR_PX}px` }}>
        <div className="psc-corner" title={`Grid times are shown in ${zone}`}>{zoneShortName(zone, clock)}</div>
        {days.map((key) => (
          <div key={key} className={`psc-day-head ${key === todayKey ? "psc-day-today" : ""}`}>
            <span>{formatWeekday(key)}</span>
            <strong>{dayOfMonth(key)}</strong>
          </div>
        ))}

        <div className="psc-allday-label">All day</div>
        {days.map((key, index) => (
          <div key={`allday-${key}`} className="psc-allday-cell">
            {allDay[index].map((event) => (
              <Link key={event.key} href={event.href} className="psc-chip psc-chip-mock" title={event.subtitle}>
                {event.title}
              </Link>
            ))}
          </div>
        ))}

        <div className="psc-gutter" style={{ height: bodyHeight }}>
          {Array.from({ length: endHour - startHour }, (_, offset) => (
            <span key={offset} className="psc-hour-label" style={{ top: offset * HOUR_PX }}>
              {hourLabel(startHour + offset)}
            </span>
          ))}
        </div>

        {days.map((key, dayPosition) => (
          <div key={`col-${key}`} className="psc-day-col" style={{ height: bodyHeight }}>
            {nowLineTop !== null && dayPosition === todayIndex && (
              <div className="psc-now-line" style={{ top: nowLineTop }} aria-hidden="true" />
            )}
            {placed[dayPosition].map((placement) => {
              const event = placement.item;
              const top = (placement.startMinute - gridStartMinute) * MINUTE_PX;
              const height = Math.max((placement.endMinute - placement.startMinute) * MINUTE_PX, MIN_BLOCK_PX);
              const classes = [
                "psc-block",
                BLOCK_KIND_CLASS[event.kind],
                event.bucket === "past" ? "psc-block-past" : "",
                event.bucket === "cancelled" ? "psc-block-cancelled" : "",
              ].filter(Boolean).join(" ");
              const scheduledLabel = event.startsAt && event.timeZone
                ? `${formatClock(event.startsAt, event.timeZone)} ${zoneShortName(event.timeZone, new Date(event.startsAt))}`
                : "";
              return (
                <Link
                  key={event.key}
                  href={event.href}
                  className={classes}
                  title={scheduledLabel ? `${event.title} · scheduled ${scheduledLabel}` : event.title}
                  style={{
                    top,
                    height,
                    left: `calc(${(placement.column * 100) / placement.columns}% + 3px)`,
                    width: `calc(${100 / placement.columns}% - 6px)`,
                  }}
                >
                  <span className="psc-block-time">{event.startsAt ? formatClock(event.startsAt, zone) : ""}</span>
                  <span className="psc-block-title">{event.title}</span>
                  {height >= 52 && <span className="psc-block-sub">{event.subtitle}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
