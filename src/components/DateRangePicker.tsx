import React, { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface DateRangePickerProps {
  dateStart: string;
  dateEnd: string;
  onChange: (start: string, end: string) => void;
}

export function DateRangePicker({ dateStart, dateEnd, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (dateStart ? new Date(dateStart) : new Date()));
  const [start, setStart] = useState<Date | null>(dateStart ? new Date(`${dateStart}T12:00:00`) : null);
  const [end, setEnd] = useState<Date | null>(dateEnd ? new Date(`${dateEnd}T12:00:00`) : null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStart(dateStart ? new Date(`${dateStart}T12:00:00`) : null);
    setEnd(dateEnd ? new Date(`${dateEnd}T12:00:00`) : null);
  }, [dateStart, dateEnd]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const days: Array<Date | null> = [];
  for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i, 12, 0, 0));

  function handleDayClick(day: Date) {
    if (!start || (start && end)) {
      setStart(day);
      setEnd(null);
      return;
    }

    if (day < start) {
      setStart(day);
      setEnd(null);
      return;
    }

    setEnd(day);
    onChange(start.toISOString().split("T")[0], day.toISOString().split("T")[0]);
    setIsOpen(false);
  }

  function isSameDay(a: Date | null, b: Date | null) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function isInRange(day: Date) {
    if (!start || !end) return false;
    return day > start && day < end;
  }

  function formatDisplay() {
    if (!dateStart && !dateEnd) return "Select date range";
    const startLabel = dateStart
      ? new Date(`${dateStart}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "?";
    const endLabel = dateEnd
      ? new Date(`${dateEnd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "?";
    return `${startLabel} - ${endLabel}`;
  }

  function clearSelection(event: React.MouseEvent) {
    event.stopPropagation();
    setStart(null);
    setEnd(null);
    onChange("", "");
  }

  return (
    <div className="relative" ref={containerRef} style={{ zIndex: 50 }}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 13,
          width: 260,
          justifyContent: "space-between",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={16} style={{ color: "var(--ink-soft)" }} />
          <span>{formatDisplay()}</span>
        </div>
        {(dateStart || dateEnd) && (
          <span onClick={clearSelection} style={{ color: "var(--ink-soft)", fontSize: 18, lineHeight: "10px" }}>
            &times;
          </span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
            padding: 16,
            width: 320,
            color: "var(--ink)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              style={{ padding: 4, borderRadius: "50%", background: "var(--bg)", color: "var(--ink)", border: "none", cursor: "pointer" }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {viewDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              style={{ padding: 4, borderRadius: "50%", background: "var(--bg)", color: "var(--ink)", border: "none", cursor: "pointer" }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8, textAlign: "center", fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((label) => <div key={label}>{label}</div>)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {days.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} />;

              const isStart = isSameDay(day, start);
              const isEnd = isSameDay(day, end);
              const inRange = isInRange(day);

              let background = "transparent";
              let color = "var(--ink)";
              let borderRadius = "4px";

              if (isStart || isEnd) {
                background = "var(--accent)";
                color = "white";
              } else if (inRange) {
                background = "var(--accent-soft)";
                color = "var(--accent)";
              }

              if (isStart && end) borderRadius = "4px 0 0 4px";
              else if (isEnd && start) borderRadius = "0 4px 4px 0";
              else if (inRange) borderRadius = "0";

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  style={{
                    background,
                    color,
                    borderRadius,
                    padding: "8px 0",
                    fontSize: 14,
                    textAlign: "center",
                    cursor: "pointer",
                    border: "none",
                    outline: "none",
                    fontWeight: isStart || isEnd ? 600 : 500,
                  }}
                  onMouseEnter={(event) => {
                    if (!isStart && !isEnd && !inRange) event.currentTarget.style.background = "var(--bg)";
                  }}
                  onMouseLeave={(event) => {
                    if (!isStart && !isEnd && !inRange) event.currentTarget.style.background = "transparent";
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
