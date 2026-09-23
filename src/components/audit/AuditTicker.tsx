"use client";
import { useEffect, useState } from "react";
import { Sparkles, Quote } from "lucide-react";

interface TickerItem {
  kind: "note" | "action";
  text: string;
  meta: string;
}

interface Props {
  stickyNotes: Array<{ content: string; author: string; date: string; category: string }>;
  latestActionItems: Array<{ title: string; action: string }>;
}

/** Candidate-page-scoped rolling ticker, adapted from skarion-student-audit's TickerBar.jsx (roster-wide there, single-candidate here). */
export function AuditTicker({ stickyNotes, latestActionItems }: Props) {
  const items: TickerItem[] = [
    ...stickyNotes.slice(0, 6).map((n) => ({ kind: "note" as const, text: n.content, meta: `${n.author} · ${n.date}` })),
    ...latestActionItems.slice(0, 4).map((a) => ({ kind: "action" as const, text: a.action, meta: a.title })),
  ];

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(timer);
  }, [items.length, paused]);

  if (items.length === 0) return null;

  const current = items[index % items.length];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="card"
      style={{
        padding: "0.65rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: current.kind === "action" ? "var(--accent-soft)" : "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      {current.kind === "action" ? <Sparkles size={16} color="var(--accent)" style={{ flexShrink: 0 }} /> : <Quote size={16} color="var(--ink-soft)" style={{ flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.text}</p>
        <span className="muted" style={{ fontSize: 11 }}>{current.meta}</span>
      </div>
      {items.length > 1 && (
        <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
          {(index % items.length) + 1}/{items.length}
        </span>
      )}
    </div>
  );
}
