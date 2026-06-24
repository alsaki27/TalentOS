import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface DateRangePickerProps {
  dateStart: string;
  dateEnd: string;
  onChange: (start: string, end: string) => void;
}

export function DateRangePicker({ dateStart, dateEnd, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Track currently viewed month
  const [viewDate, setViewDate] = useState(() => {
    return dateStart ? new Date(dateStart) : new Date();
  });
  
  // Internal state for selection
  const [start, setStart] = useState<Date | null>(dateStart ? new Date(dateStart + 'T12:00:00') : null);
  const [end, setEnd] = useState<Date | null>(dateEnd ? new Date(dateEnd + 'T12:00:00') : null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync props -> state
  useEffect(() => {
    setStart(dateStart ? new Date(dateStart + 'T12:00:00') : null);
    setEnd(dateEnd ? new Date(dateEnd + 'T12:00:00') : null);
  }, [dateStart, dateEnd]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  
  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i, 12, 0, 0));
  }

  const handleDayClick = (day: Date) => {
    if (!start || (start && end)) {
      setStart(day);
      setEnd(null);
    } else {
      if (day < start) {
        setStart(day);
        setEnd(null);
      } else {
        setEnd(day);
        // Both selected, fire change
        onChange(
          start.toISOString().split('T')[0],
          day.toISOString().split('T')[0]
        );
        setIsOpen(false);
      }
    }
  };

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };
  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const isSameDay = (d1: Date | null, d2: Date | null) => {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() && 
           d1.getMonth() === d2.getMonth() && 
           d1.getDate() === d2.getDate();
  };

  const isInRange = (day: Date) => {
    if (!start || !end) return false;
    return day > start && day < end;
  };

  const formatDisplay = () => {
    if (!dateStart && !dateEnd) return "Select date range";
    const s = dateStart ? new Date(dateStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
    const e = dateEnd ? new Date(dateEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
    return `${s} - ${e}`;
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", "");
    setStart(null);
    setEnd(null);
  };

  return (
    <div className="relative" ref={containerRef} style={{ zIndex: 50 }}>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--ink)',
          fontSize: '13px', width: '260px', justifyContent: 'space-between',
          fontFamily: 'inherit'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={16} style={{ color: 'var(--ink-soft)' }} />
          <span>{formatDisplay()}</span>
        </div>
        {(dateStart || dateEnd) && (
          <span onClick={clearSelection} style={{ color: 'var(--ink-soft)', fontSize: '18px', lineHeight: '10px' }}>&times;</span>
        )}
      </button>

      {isOpen && (
        <div 
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '8px',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2)', padding: '16px',
            width: '320px', color: 'var(--ink)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button type="button" onClick={handlePrevMonth} style={{ padding: '4px', borderRadius: '50%', background: 'var(--bg)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}><ChevronLeft size={16} /></button>
            <span style={{ fontWeight: '600', fontSize: '15px' }}>
              {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" onClick={handleNextMonth} style={{ padding: '4px', borderRadius: '50%', background: 'var(--bg)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}><ChevronRight size={16} /></button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px', textAlign: 'center', fontSize: '12px', color: 'var(--ink-soft)', fontWeight: '600' }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {days.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />;
              
              const isStart = isSameDay(day, start);
              const isEnd = isSameDay(day, end);
              const inRange = isInRange(day);
              
              let bg = 'transparent';
              let color = 'var(--ink)';
              let borderRadius = '4px';
              
              if (isStart || isEnd) {
                bg = 'var(--accent)';
                color = 'white';
              } else if (inRange) {
                bg = 'var(--accent-soft)';
                color = 'var(--accent)';
              }
              
              if (isStart && end) {
                borderRadius = '4px 0 0 4px';
              } else if (isEnd && start) {
                borderRadius = '0 4px 4px 0';
              } else if (inRange) {
                borderRadius = '0';
              }

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  style={{
                    background: bg, color, borderRadius,
                    padding: '8px 0', fontSize: '14px', textAlign: 'center',
                    cursor: 'pointer', border: 'none', outline: 'none',
                    fontWeight: (isStart || isEnd) ? '600' : '500'
                  }}
                  onMouseEnter={(e) => {
                    if (!isStart && !isEnd && !inRange) e.currentTarget.style.background = 'var(--bg)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isStart && !isEnd && !inRange) e.currentTarget.style.background = 'transparent';
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
