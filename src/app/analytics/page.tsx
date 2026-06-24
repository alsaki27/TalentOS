// src/app/analytics/page.tsx
// Advanced Analytics Dashboard — Overview

"use client";

import { useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import BarChart from "@/components/BarChart";
import PieChart from "@/components/PieChart";

/* ─── Icons ─── */
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconBriefcase({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function IconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22 6 12 13 2 6" />
    </svg>
  );
}
function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/* ─── Date helpers ─── */
function getDateRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let from: string;
  switch (preset) {
    case "7d": {
      const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString(); break;
    }
    case "30d": {
      const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString(); break;
    }
    case "90d": {
      const d = new Date(now); d.setDate(d.getDate() - 90); from = d.toISOString(); break;
    }
    case "ytd": {
      from = new Date(now.getFullYear(), 0, 1).toISOString(); break;
    }
    default:
      from = "";
  }
  return { from, to };
}

/* ─── Main page ─── */
export default function AnalyticsPage() {
  const [preset, setPreset] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [timeToFill, setTimeToFill] = useState<any>(null);
  const [sources, setSources] = useState<any>(null);
  const [diversity, setDiversity] = useState<any>(null);
  const [recruiters, setRecruiters] = useState<any>(null);

  const dateRange = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo ? new Date(customTo + "T23:59:59.999Z").toISOString() : "",
      };
    }
    if (preset === "all") return { from: "", to: "" };
    return getDateRange(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateRange.from) params.set("dateFrom", dateRange.from);
    if (dateRange.to) params.set("dateTo", dateRange.to);

    Promise.all([
      fetch(`/api/analytics/summary?${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/analytics/funnel?${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/analytics/time-to-fill?${params}&groupBy=role`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/analytics/sources?${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/analytics/diversity?${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/analytics/recruiters?${params}`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([sum, fun, ttf, src, div, rec]) => {
      setSummary(sum);
      setFunnel(fun);
      setTimeToFill(ttf);
      setSources(src);
      setDiversity(div);
      setRecruiters(rec);
      setLoading(false);
    });
  }, [dateRange.from, dateRange.to]);

  /* ─── Recruiter sort ─── */
  const [sortBy, setSortBy] = useState("hiresMade");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRecruiters = useMemo(() => {
    if (!recruiters?.recruiters) return [];
    const list = [...recruiters.recruiters];
    list.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list.slice(0, 5);
  }, [recruiters, sortBy, sortDir]);

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: string) => {
    if (sortBy !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  /* ─── Funnel chart data ─── */
  const funnelData = useMemo(() => {
    if (!funnel?.stages) return [];
    const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "var(--accent)"];
    return funnel.stages.map((s: any, i: number) => ({
      label: s.stage,
      value: s.count,
      color: colors[i],
    }));
  }, [funnel]);

  /* ─── Time-to-fill data ─── */
  const ttfData = useMemo(() => {
    if (!timeToFill?.data) return [];
    return timeToFill.data.map((d: any) => ({
      label: d.label,
      value: d.avgDays,
    }));
  }, [timeToFill]);

  /* ─── Source data ─── */
  const sourceData = useMemo(() => {
    if (!sources?.sources) return [];
    return sources.sources
      .filter((s: any) => s.count > 0)
      .map((s: any) => ({
        label: s.name,
        value: s.count,
      }));
  }, [sources]);

  /* ─── Render ─── */
  return (
    <>
      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(["7d", "30d", "90d", "ytd", "all"] as const).map((p) => (
          <button
            key={p}
            className={preset === p ? "btn-primary" : ""}
            onClick={() => setPreset(p)}
          >
            {p === "7d" ? "7 days" : p === "30d" ? "30 days" : p === "90d" ? "90 days" : p === "ytd" ? "YTD" : "All time"}
          </button>
        ))}
        <button
          className={preset === "custom" ? "btn-primary" : ""}
          onClick={() => setPreset("custom")}
        >
          Custom
        </button>
        {preset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Total candidates"
          value={summary?.totalCandidates ?? "—"}
          icon={<IconUsers />}
        />
        <StatCard
          label="Active jobs"
          value={summary?.activeJobs ?? "—"}
          icon={<IconBriefcase />}
        />
        <StatCard
          label="Apps this month"
          value={summary?.applicationsThisMonth ?? "—"}
          icon={<IconFileText />}
        />
        <StatCard
          label="Interviews this week"
          value={summary?.interviewsThisWeek ?? "—"}
          icon={<IconCalendar />}
        />
        <StatCard
          label="Offers extended"
          value={summary?.offersExtended ?? "—"}
          icon={<IconMail />}
        />
        <StatCard
          label="Hires made"
          value={summary?.hiresMade ?? "—"}
          icon={<IconCheckCircle />}
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Hiring Funnel */}
        <div className="card lg:col-span-2">
          <h2 className="section-title">Hiring Funnel</h2>
          {loading ? (
            <div className="loading-panel">Loading funnel…</div>
          ) : funnelData.length === 0 ? (
            <div className="empty">No funnel data for this period.</div>
          ) : (
            <div className="space-y-4">
              <BarChart data={funnelData} orientation="vertical" />
              <div className="grid grid-cols-6 gap-2 text-center mt-2">
                {funnel?.stages?.map((s: any) => (
                  <div key={s.stage} className="text-xs text-[var(--ink-soft)]">
                    <div className="font-semibold text-[var(--ink)]">{s.count}</div>
                    {s.conversionRate !== null && (
                      <div>{s.conversionRate}% conv.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Time-to-Fill */}
        <div className="card">
          <h2 className="section-title">Time-to-Fill by Role</h2>
          {loading ? (
            <div className="loading-panel">Loading…</div>
          ) : ttfData.length === 0 ? (
            <div className="empty">No filled jobs in this period.</div>
          ) : (
            <BarChart data={ttfData} orientation="horizontal" />
          )}
        </div>

        {/* Source Effectiveness */}
        <div className="card">
          <h2 className="section-title">Source Effectiveness</h2>
          {loading ? (
            <div className="loading-panel">Loading…</div>
          ) : sourceData.length === 0 ? (
            <div className="empty">No source data.</div>
          ) : (
            <BarChart data={sourceData} orientation="horizontal" />
          )}
        </div>

        {/* Diversity */}
        <div className="card lg:col-span-2">
          <h2 className="section-title">Diversity Breakdown</h2>
          {loading ? (
            <div className="loading-panel">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink-soft)] text-center mb-3">Gender</h3>
                {diversity?.gender?.length ? (
                  <PieChart data={diversity.gender.map((g: any) => ({ label: g.label, value: g.count }))} />
                ) : (
                  <div className="empty text-sm">No gender data.</div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink-soft)] text-center mb-3">Ethnicity</h3>
                {diversity?.ethnicity?.length ? (
                  <PieChart data={diversity.ethnicity.map((e: any) => ({ label: e.label, value: e.count }))} />
                ) : (
                  <div className="empty text-sm">No ethnicity data.</div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink-soft)] text-center mb-3">Geography</h3>
                {diversity?.geography?.length ? (
                  <PieChart data={diversity.geography.map((g: any) => ({ label: g.label, value: g.count }))} />
                ) : (
                  <div className="empty text-sm">No geography data.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recruiter Leaderboard */}
      <div className="card">
        <h2 className="section-title">Recruiter Leaderboard</h2>
        {loading ? (
          <div className="loading-panel">Loading…</div>
        ) : sortedRecruiters.length === 0 ? (
          <div className="empty">No recruiter activity for this period.</div>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Recruiter</th>
                  <th className="cursor-pointer" onClick={() => toggleSort("candidatesSourced")}>
                    Sourced{sortIndicator("candidatesSourced")}
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort("applicationsReviewed")}>
                    Reviewed{sortIndicator("applicationsReviewed")}
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort("interviewsScheduled")}>
                    Interviews{sortIndicator("interviewsScheduled")}
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort("offersExtended")}>
                    Offers{sortIndicator("offersExtended")}
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort("hiresMade")}>
                    Hires{sortIndicator("hiresMade")}
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort("avgTimeToFill")}>
                    Avg TTF (days){sortIndicator("avgTimeToFill")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRecruiters.map((r: any) => (
                  <tr key={r.name}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.candidatesSourced}</td>
                    <td>{r.applicationsReviewed}</td>
                    <td>{r.interviewsScheduled}</td>
                    <td>{r.offersExtended}</td>
                    <td>{r.hiresMade}</td>
                    <td>{r.avgTimeToFill || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
