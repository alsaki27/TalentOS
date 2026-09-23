// src/app/analytics/audits/page.tsx
// Audit-tool analytics — ported from skarion-student-audit's AnalyticsView.jsx
// (avg score over time, weakness themes, evaluator/mentor leaderboard).

"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import BarChart from "@/components/BarChart";

interface AuditSession {
  id: string;
  session_date: string;
  overall_score: number | null;
  created_by: string;
  student_id: string;
  student_name: string;
}

interface AuditWeakness {
  theme: string | null;
  student_id: string;
}

export default function AuditsAnalyticsPage() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [weaknesses, setWeaknesses] = useState<AuditWeakness[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/audits?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setWeaknesses(d.weaknesses ?? []);
      })
      .finally(() => setLoading(false));
  }, [days]);

  const scored = sessions.filter((s) => s.overall_score !== null);
  const avgScore = scored.length ? (scored.reduce((sum, s) => sum + (s.overall_score ?? 0), 0) / scored.length).toFixed(1) : "—";
  const uniqueCandidates = new Set(sessions.map((s) => s.student_id)).size;

  const mentorCounts = new Map<string, number>();
  for (const s of sessions) mentorCounts.set(s.created_by, (mentorCounts.get(s.created_by) ?? 0) + 1);
  const leaderboard = Array.from(mentorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));

  const themeCounts = new Map<string, { count: number; candidates: Set<string> }>();
  for (const w of weaknesses) {
    if (!w.theme) continue;
    const entry = themeCounts.get(w.theme) ?? { count: 0, candidates: new Set() };
    entry.count += 1;
    entry.candidates.add(w.student_id);
    themeCounts.set(w.theme, entry);
  }
  const themeRanking = Array.from(themeCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  // Score trend as a simple monthly bucket bar chart
  const monthly = new Map<string, { sum: number; count: number }>();
  for (const s of scored) {
    const key = s.session_date.slice(0, 7);
    const entry = monthly.get(key) ?? { sum: 0, count: 0 };
    entry.sum += s.overall_score ?? 0;
    entry.count += 1;
    monthly.set(key, entry);
  }
  const trend = Array.from(monthly.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, v]) => ({ label, value: Math.round((v.sum / v.count) * 10) / 10 }));

  if (loading) return <p className="muted">Loading audit analytics...</p>;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Mock interview audits</h2>
        <select className="input" style={{ maxWidth: 160 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">No mock interview sessions recorded in this window yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard label="Sessions" value={sessions.length} />
            <StatCard label="Candidates audited" value={uniqueCandidates} />
            <StatCard label="Average score" value={avgScore === "—" ? "—" : `${avgScore} / 10`} />
          </div>

          {trend.length > 1 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, marginTop: 0 }}>Average score by month</h3>
              <BarChart data={trend} maxValue={10} />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 14, marginTop: 0 }}>Roster weakness themes</h3>
              {themeRanking.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No parsed weaknesses yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {themeRanking.map(([theme, v]) => (
                    <div key={theme} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{theme}</span>
                      <span className="muted">{v.count} hits · {v.candidates.size} candidates</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ fontSize: 14, marginTop: 0 }}>Mentor leaderboard (sessions logged)</h3>
              {leaderboard.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No sessions yet.</p>
              ) : (
                <BarChart data={leaderboard} orientation="horizontal" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
