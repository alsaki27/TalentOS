"use client";

import { CalendarClock, RefreshCcw, Inbox } from "lucide-react";

interface ActionItem { id: string; type: "interview" | "follow_up"; title: string; description: string; due_at: string | null; href: string; }

interface Props {
  actionItems: ActionItem[];
  loading?: boolean;
}

function formatDue(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CandidatePortalNextUp({ actionItems, loading }: Props) {
  return (
    <section className="portal-section" aria-labelledby="actions-heading">
      <div className="portal-section-heading">
        <div>
          <div className="portal-eyebrow">Stay ready</div>
          <h2 id="actions-heading" className="portal-section-heading-title">Next up</h2>
        </div>
        <span className="portal-count-badge">{actionItems.length}</span>
      </div>
      {loading ? (
        <div className="portal-list" aria-label="Loading reminders">
          {[1, 2, 3].map((item) => <div className="portal-skeleton" style={{ height: 68 }} key={item} />)}
        </div>
      ) : actionItems.length === 0 ? (
        <div className="portal-empty portal-action-empty">
          <div className="portal-empty-icon"><Inbox size={26} /></div>
          <strong>You&apos;re all caught up.</strong>
          <span>New interview and follow-up reminders will appear here.</span>
        </div>
      ) : (
        <div className="portal-action-list">
          {actionItems.map((item) => (
            <a className="portal-action-card" href={item.href} key={item.id}>
              <span className={`portal-action-icon portal-action-${item.type}`}>
                {item.type === "interview" ? <CalendarClock size={14} /> : <RefreshCcw size={14} />}
              </span>
              <span className="portal-action-copy">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <span className="portal-action-due">{formatDue(item.due_at)}<br /><small>View</small></span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
