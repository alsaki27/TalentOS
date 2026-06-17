// src/app/analytics/page.tsx
"use client";

import { useEffect, useState } from "react";

interface Analytics {
  totals: { candidates: number; jobs: number; applications: number };
  statusBreakdown: Record<string, number>;
  rates: { responseRate: number; interviewRate: number; offerRate: number };
  bySource: { source: string; jobs: number; applications: number; interviewRate: number; offerRate: number; lastSeenAt: string | null }[];
  byResume: { resumeId: string; label: string; used: number; interviewRate: number }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics").then((r) => r.json()).then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) return <p className="muted">No data.</p>;

  return (
    <>
      <div className="page-header">
        <h1>Analytics</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Candidates" value={data.totals.candidates} />
        <SummaryCard label="Jobs tracked" value={data.totals.jobs} />
        <SummaryCard label="Applications" value={data.totals.applications} />
        <SummaryCard label="Response rate" value={`${data.rates.responseRate}%`} />
        <SummaryCard label="Interview rate" value={`${data.rates.interviewRate}%`} />
        <SummaryCard label="Offer rate" value={`${data.rates.offerRate}%`} />
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>By job source</h2>
      {data.bySource.length === 0 ? (
        <div className="empty" style={{ marginBottom: 24 }}>No jobs yet.</div>
      ) : (
        <table className="table" style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Source</th>
              <th>Jobs</th>
              <th>Applications</th>
              <th>Interview rate</th>
              <th>Offer rate</th>
              <th>Last synced</th>
            </tr>
          </thead>
          <tbody>
            {data.bySource.map((s) => (
              <tr key={s.source}>
                <td><span className="badge">{s.source}</span></td>
                <td>{s.jobs}</td>
                <td>{s.applications}</td>
                <td>{s.interviewRate}%</td>
                <td>{s.offerRate}%</td>
                <td className="muted">{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>By resume version</h2>
      {data.byResume.length === 0 ? (
        <div className="empty">No applications have used a tracked resume variant yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Resume</th>
              <th>Times used</th>
              <th>Interview rate</th>
            </tr>
          </thead>
          <tbody>
            {data.byResume.map((r) => (
              <tr key={r.resumeId}>
                <td><strong>{r.label}</strong></td>
                <td>{r.used}</td>
                <td>{r.interviewRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <label>{label}</label>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{value}</p>
    </div>
  );
}
