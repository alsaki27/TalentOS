"use client";

interface TrendPoint { bucket: string; count: number; }
interface ActionItem { id: string; type: "interview" | "follow_up"; title: string; description: string; due_at: string | null; href: string; }

interface Props {
  trend: { hourly24h: TrendPoint[]; daily7d: TrendPoint[]; monthly6m: TrendPoint[] };
  actionItems: ActionItem[];
}

function labelFor(bucket: string, mode: "hour" | "day" | "month") {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return mode === "hour" ? date.toLocaleTimeString([], { hour: "numeric" }) : mode === "day" ? date.toLocaleDateString([], { weekday: "short" }) : date.toLocaleDateString([], { month: "short" });
}

function MiniChart({ title, points, mode }: { title: string; points: TrendPoint[]; mode: "hour" | "day" | "month" }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  return <div className="portal-chart-card"><div className="portal-chart-heading"><h3>{title}</h3><span>{points.reduce((sum, point) => sum + point.count, 0)} applications</span></div><div className="portal-chart" role="img" aria-label={`${title}: ${points.reduce((sum, point) => sum + point.count, 0)} applications`}>{points.map((point) => <div className="portal-chart-column" key={point.bucket} title={`${point.count} applications`}><div className="portal-chart-bar" style={{ height: `${Math.max(point.count ? 10 : 3, (point.count / max) * 100)}%` }} /><span>{labelFor(point.bucket, mode)}</span></div>)}</div></div>;
}

function formatDue(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CandidatePortalInsights({ trend, actionItems }: Props) {
  return <>
    <section className="portal-section" aria-labelledby="insights-heading"><div className="portal-section-heading"><div><div className="portal-eyebrow">Activity</div><h2 id="insights-heading" className="portal-section-heading-title">Your application momentum</h2></div></div><div className="portal-chart-grid"><MiniChart title="Last 24 hours" points={trend.hourly24h} mode="hour" /><MiniChart title="Last 7 days" points={trend.daily7d} mode="day" /><MiniChart title="Last 6 months" points={trend.monthly6m} mode="month" /></div></section>
    <section className="portal-section" aria-labelledby="actions-heading"><div className="portal-section-heading"><div><div className="portal-eyebrow">Stay ready</div><h2 id="actions-heading" className="portal-section-heading-title">Next up</h2></div><span className="portal-count-badge">{actionItems.length}</span></div>{actionItems.length === 0 ? <div className="portal-empty portal-action-empty"><strong>You&apos;re all caught up.</strong><span>New interview and follow-up reminders will appear here.</span></div> : <div className="portal-action-list">{actionItems.map((item) => <a className="portal-action-card" href={item.href} key={item.id}><span className={`portal-action-icon portal-action-${item.type}`}>{item.type === "interview" ? "I" : "F"}</span><span className="portal-action-copy"><strong>{item.title}</strong><span>{item.description}</span></span><span className="portal-action-due">{formatDue(item.due_at)}<br /><small>View</small></span></a>)}</div>}</section>
  </>;
}
