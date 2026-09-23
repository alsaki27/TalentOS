"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CalendarEvent {
  id: string;
  event_date: string;
  title: string;
  event_type: string;
}

interface Props {
  events: CalendarEvent[];
  onDeleteEvent: (id: string) => void;
}

const EVENT_COLORS: Record<string, string> = {
  mock_interview: "var(--accent)",
  meeting: "#38bdf8",
  deadline: "var(--danger)",
  suggested_mock: "var(--warn)",
  other: "var(--ink-soft)",
};

export function AuditCalendar({ events, onDeleteEvent }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDay = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const d = new Date(e.event_date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!eventsByDay.has(day)) eventsByDay.set(day, []);
      eventsByDay.get(day)!.push(e);
    }
  }

  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });

  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button className="btn-compact btn-sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <strong style={{ fontSize: 13 }}>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
        <button className="btn-compact btn-sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 10, color: "var(--ink-soft)", marginBottom: 4 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ textAlign: "center" }}>{d}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((cell, i) => (
          <div
            key={i}
            style={{
              minHeight: 56,
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 4,
              background: cell.day && isToday(cell.day) ? "var(--accent-soft)" : "var(--surface-raised)",
              opacity: cell.day ? 1 : 0.3,
            }}
          >
            {cell.day && (
              <>
                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{cell.day}</div>
                {(eventsByDay.get(cell.day) ?? []).map((e) => (
                  <div
                    key={e.id}
                    title={`${e.title} — click to delete`}
                    onClick={() => onDeleteEvent(e.id)}
                    style={{
                      fontSize: 10,
                      marginTop: 2,
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: EVENT_COLORS[e.event_type] ?? EVENT_COLORS.other,
                      color: "#fff",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.title}
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
