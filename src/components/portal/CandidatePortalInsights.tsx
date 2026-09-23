"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";

interface TrendPoint { bucket: string; count: number; }

interface Props {
  trend: { hourly24h: TrendPoint[]; daily7d: TrendPoint[]; monthly6m: TrendPoint[] };
  loading?: boolean;
}

type Mode = "hour" | "day" | "month";

// The hourly trend query's bucket timestamps come back from Postgres with a
// bare 2-digit UTC offset ("...T18:00:00+00") - valid Postgres/ISO-8601
// output, but NOT a form the JS Date constructor accepts (it silently
// returns Invalid Date for "+00", only "+00:00" or "Z" parse) - this was the
// actual cause of the illegible "Last 24 hours" labels (they were the raw,
// unparsed bucket string truncated to a couple of characters, not a
// formatting/width issue). The daily/monthly buckets are plain date strings
// ("2026-09-01", "2026-04") with no time or offset at all, so the match is
// anchored to a full HH:MM:SS time component - a naive end-of-string
// "[+-]\d{2}" match also fires on the "-01"/"-04" day/month suffix of those
// plain dates and corrupts them instead.
function parseBucket(bucket: string): Date {
  const normalized = bucket.replace(/(T\d{2}:\d{2}:\d{2})([+-]\d{2})$/, "$1$2:00");
  return new Date(normalized);
}

// Compact label shown under every N-th bar's axis tick - dense charts (24
// hourly bars) get most labels skipped so the ones that remain have room
// to render fully instead of being clipped.
function axisLabel(bucket: string, mode: Mode) {
  const date = parseBucket(bucket);
  if (Number.isNaN(date.getTime())) return "";
  if (mode === "hour") return date.toLocaleTimeString([], { hour: "numeric" });
  if (mode === "day") return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short" });
}

// Full label shown in the hover tooltip - always complete, never clipped.
function tooltipLabel(bucket: string, mode: Mode) {
  const date = parseBucket(bucket);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  if (mode === "hour") return date.toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
  if (mode === "day") return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function MiniChart({ title, points, mode }: { title: string; points: TrendPoint[]; mode: Mode }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  // Hourly charts have 24 bars - only label every 4th one (0, 4, 8...) so
  // each visible label has room to render in full instead of truncating.
  const labelEvery = mode === "hour" ? 4 : 1;

  return (
    <div className="portal-chart-card">
      <div className="portal-chart-heading">
        <h3>{title}</h3>
        <span>{total.toLocaleString()} applications</span>
      </div>
      <div className="portal-chart" role="img" aria-label={`${title}: ${total} applications`}>
        {points.map((point, index) => (
          <div
            className="portal-chart-column"
            key={point.bucket}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
          >
            {hoverIndex === index && (
              <div className="portal-chart-tooltip">
                <strong>{point.count.toLocaleString()}</strong> application{point.count === 1 ? "" : "s"}
                <span>{tooltipLabel(point.bucket, mode)}</span>
              </div>
            )}
            <div
              className={`portal-chart-bar ${hoverIndex === index ? "portal-chart-bar-active" : ""}`}
              style={{ height: `${Math.max(point.count ? 6 : 2, (point.count / max) * 100)}%` }}
            />
            <span className="portal-chart-axis-label">{index % labelEvery === 0 ? axisLabel(point.bucket, mode) : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CandidatePortalInsights({ trend, loading }: Props) {
  return (
    <section className="portal-section" aria-labelledby="insights-heading">
      <div className="portal-section-heading">
        <div>
          <div className="portal-eyebrow">Activity</div>
          <h2 id="insights-heading" className="portal-section-heading-title">
            <TrendingUp size={20} style={{ verticalAlign: -3, marginRight: 8, color: "var(--p-coral)" }} />
            Your application momentum
          </h2>
        </div>
      </div>
      {loading ? (
        <div className="portal-chart-grid">
          {[0, 1, 2].map((i) => <div key={i} className="portal-skeleton" style={{ height: 260 }} />)}
        </div>
      ) : (
        <div className="portal-chart-grid">
          <MiniChart title="Last 24 hours" points={trend.hourly24h} mode="hour" />
          <MiniChart title="Last 7 days" points={trend.daily7d} mode="day" />
          <MiniChart title="Last 6 months" points={trend.monthly6m} mode="month" />
        </div>
      )}
    </section>
  );
}
