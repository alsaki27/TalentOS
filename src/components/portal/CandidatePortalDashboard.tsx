"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import StatusBadge, { displayStatusGroup } from "../candidates/shared/StatusBadge";
import ApplicationStatusChart from "../candidates/shared/ApplicationStatusChart";
import ApplicationSourceChart from "../candidates/shared/ApplicationSourceChart";
import ApplicationsDataTable from "../candidates/shared/ApplicationsDataTable";
import MatchScoreBadge from "../candidates/shared/MatchScoreBadge";

interface PortalDashboardApp {
  application_id: string;
  status: string;
  public_status: { stage: string; label: string };
  applied_at: string | null;
  job_id: string;
  job_title: string;
  company_name: string;
  job_source: string;
  location: string | null;
  fit_score: number | null;
}

interface PortalDashboardData {
  name: string;
  applications: PortalDashboardApp[];
  total: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
}

var STATUS_ICONS: Record<string, string> = {
  Applied: "✅",
  Interview: "🎯",
  Offer: "🏆",
  Closed: "❌",
};

export default function CandidatePortalDashboard({ token }: { token: string }) {
  var [data, setData] = useState<PortalDashboardData | null>(null);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState<string | null>(null);

  useEffect(function () {
    if (!token) return;
    setLoading(true);
    fetch("/api/portal/" + token + "/dashboard")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) { setData(d); setLoading(false); })
      .catch(function (err) { setError(err.message ?? String(err)); setLoading(false); });
  }, [token]);

  if (loading) return <p style={{ color: "var(--ink-soft)" }}>Loading dashboard...</p>;
  if (error) return <p style={{ color: "var(--danger)" }}>Failed to load: {error}</p>;
  if (!data) return null;

  var statusCounts = data.statusCounts ?? {};
  var sourceCounts = data.sourceCounts ?? {};

  var statusChartData = ["Applied", "Interview", "Offer", "Closed"].map(function (label) {
    return { label: label, count: statusCounts[label] || 0 };
  });
  var sourceChartData = Object.keys(sourceCounts).sort().map(function (key) {
    return { label: key === "company_site" ? "Company Site" : key.charAt(0).toUpperCase() + key.slice(1), count: sourceCounts[key] };
  });

  // Transform portal apps to DashboardApplication shape for the table
  var tableApps = data.applications.map(function (app) { return {
    application_id: app.application_id,
    status: app.status,
    applied_at: app.applied_at,
    follow_up_at: null,
    job_id: app.job_id,
    job_title: app.job_title,
    company_name: app.company_name,
    company_website: null,
    job_source: app.job_source,
    source_url: null,
    location: app.location,
    fit_score: app.fit_score,
    recommendation: null,
    tailored_resume_version_id: null,
  }; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {[
          { label: "Total", value: String(data.total) },
          { label: "Applied", value: String(statusCounts["Applied"] || 0) },
          { label: "Interview", value: String(statusCounts["Interview"] || 0) },
          { label: "Offer", value: String(statusCounts["Offer"] || 0) },
          { label: "Closed", value: String(statusCounts["Closed"] || 0) },
        ].map(function (card) { return (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={STATUS_ICONS[card.label] ? (
              <span style={{ fontSize: 18 }}>{STATUS_ICONS[card.label]}</span>
            ) : undefined}
          />
        ); })}
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>
            Application Status Distribution
          </h3>
          <ApplicationStatusChart data={statusChartData} />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>
            Source Breakdown
          </h3>
          <ApplicationSourceChart data={sourceChartData} />
        </div>
      </div>

      {/* Table */}
      {tableApps.length === 0 ? (
        <div className="empty">No applications submitted yet — check back soon.</div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
            Application Records ({tableApps.length})
          </h3>
          <ApplicationsDataTable
            applications={tableApps}
            readOnly={true}
            totalCount={tableApps.length}
            page={1}
            pageSize={tableApps.length}
            onPageChange={function () {}}
            sort="applied_at"
            order="desc"
            onSort={function () {}}
          />
        </div>
      )}
    </div>
  );
}
