"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatCard from "@/components/StatCard";
import ApplicationStatusChart from "./shared/ApplicationStatusChart";
import ApplicationSourceChart from "./shared/ApplicationSourceChart";
import ApplicationsDataTable from "./shared/ApplicationsDataTable";
import ApplicationNotesModal from "./shared/ApplicationNotesModal";

interface DashboardRow {
  application_id: string;
  status: string;
  priority: string | null;
  applied_at: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  job_id: string;
  job_title: string;
  company_name: string;
  job_source: string;
  source_url: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  fit_score: number | null;
  recommendation: string | null;
}

interface DashboardData {
  applications: DashboardRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
}

var STATUS_ICONS: Record<string, string> = { Applied: "✅", Screening: "📞", Interview: "🎯", Offer: "🏆", Rejected: "❌" };

export default function CandidateApplicationsDashboard({ candidateId }: { candidateId: string }) {
  var router = useRouter();
  var searchParams = useSearchParams();
  var [data, setData] = useState<DashboardData | null>(null);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState<string | null>(null);
  var [notesAppId, setNotesAppId] = useState<string | null>(null);

  var statusGroup = searchParams.get("statusGroup") || "";
  var source = searchParams.get("source") || "";
  var page = parseInt(searchParams.get("page") || "1", 10) || 1;
  var sort = searchParams.get("sort") || "applied_at";
  var order = searchParams.get("order") || "desc";
  var search = searchParams.get("search") || "";

  var fetchData = useCallback(function () {
    setLoading(true);
    setError(null);
    var params = new URLSearchParams();
    params.set("pageSize", "25");
    if (search) params.set("search", search);
    if (statusGroup) params.set("statusGroup", statusGroup);
    if (source) params.set("source", source);
    if (page > 1) params.set("page", String(page));
    if (sort !== "applied_at") params.set("sort", sort);
    if (order !== "desc") params.set("order", order);

    fetch("/api/candidates/" + candidateId + "/applications/dashboard?" + params.toString())
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { setData(d); setLoading(false); })
      .catch(function (err) { setError(err.message ?? String(err)); setLoading(false); });
  }, [candidateId, search, statusGroup, source, page, sort, order]);

  useEffect(function () { fetchData(); }, [fetchData]);

  function setParam(key: string, value: string) {
    var next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    router.push("?" + next.toString());
  }

  function setParamMultiple(updates: Record<string, string>) {
    var next = new URLSearchParams(searchParams.toString());
    var resetPage = false;
    for (var k in updates) { if (k !== "page") resetPage = true; if (updates[k]) next.set(k, updates[k]); else next.delete(k); }
    if (resetPage) next.delete("page");
    router.push("?" + next.toString());
  }

  async function handleStatusChange(applicationId: string, newStatus: string) {
    try {
      var res = await fetch("/api/applications/" + applicationId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      fetchData();
    } catch (err) { console.error("Status change failed:", err); }
  }

  var statusCounts = data?.statusCounts ?? {};
  var sourceCounts = data?.sourceCounts ?? {};

  var statusChartData = ["Applied", "Screening", "Interview", "Offer", "Rejected"].map(function (l) { return { label: l, count: statusCounts[l] || 0 }; });
  var sourceChartData = Object.keys(sourceCounts).sort().map(function (k) { return { label: k === "company_site" ? "Company Site" : k.charAt(0).toUpperCase() + k.slice(1), count: sourceCounts[k] }; });

  if (error) return <div style={{ color: "var(--danger)", padding: 16, background: "rgba(244,63,94,0.08)", borderRadius: 10, fontSize: 13, border: "1px solid rgba(244,63,94,0.25)" }}>Failed to load: {error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {[
          { label: "Total", value: String(data?.total ?? 0), group: "" },
          { label: "Applied", value: String(statusCounts["Applied"] || 0), group: "Applied" },
          { label: "Screening", value: String(statusCounts["Screening"] || 0), group: "Screening" },
          { label: "Interview", value: String(statusCounts["Interview"] || 0), group: "Interview" },
          { label: "Offer", value: String(statusCounts["Offer"] || 0), group: "Offer" },
          { label: "Rejected", value: String(statusCounts["Rejected"] || 0), group: "Rejected" },
        ].map(function (card) { return (
          <div key={card.label} onClick={function () { if (card.group) setParamMultiple({ statusGroup: card.group, source: "" }); }} style={{ cursor: card.group ? "pointer" : "default", opacity: loading ? 0.7 : 1 }} title={card.group ? "Filter by " + card.group : ""}>
            <StatCard label={card.label} value={card.value} icon={STATUS_ICONS[card.label] ? <span style={{ fontSize: 18 }}>{STATUS_ICONS[card.label]}</span> : undefined} />
          </div>
        ); })}
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 18, border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Status Distribution</h3>
          </div>
          <ApplicationStatusChart data={statusChartData} onSliceClick={function (label) { setParamMultiple({ statusGroup: label, source: "" }); }} activeLabel={statusGroup} />
        </div>
        <div className="card" style={{ padding: 18, border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📡</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Source Breakdown</h3>
          </div>
          <ApplicationSourceChart data={sourceChartData} onBarClick={function (s) { setParamMultiple({ source: s.toLowerCase().replace(/ site$/, "_site"), statusGroup: "" }); }} activeSource={source} />
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: "14px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 4 }}>🔍 Search</label>
          <input type="text" placeholder="Company, role, location..." defaultValue={search} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", fontSize: 13, outline: "none" }}
            onKeyDown={function (e) { if (e.key === "Enter") { setParamMultiple({ search: (e.target as HTMLInputElement).value, statusGroup: "", source: "" }); } }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)" }}>Status</label>
          <select value={statusGroup} onChange={function (e) { setParamMultiple({ statusGroup: e.target.value, source: "" }); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", fontSize: 13, outline: "none", cursor: "pointer", minWidth: 130 }}>
            <option value="">All Statuses</option>
            <option value="Applied">Applied</option><option value="Screening">Screening</option><option value="Interview">Interview</option><option value="Offer">Offer</option><option value="Rejected">Rejected</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)" }}>Source</label>
          <select value={source} onChange={function (e) { setParamMultiple({ source: e.target.value, statusGroup: "" }); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", fontSize: 13, outline: "none", cursor: "pointer", minWidth: 130 }}>
            <option value="">All Sources</option>
            <option value="linkedin">LinkedIn</option><option value="indeed">Indeed</option><option value="hiringcafe">HiringCafe</option><option value="glassdoor">Glassdoor</option><option value="openjobdata">OpenJobData</option><option value="extension">Extension</option><option value="company_site">Company Site</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div className="card" style={{ padding: 18, border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
            📋 Application Records
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.25)" }}>{data?.total ?? 0}</span>
          </h3>
        </div>
        {data ? (
          <ApplicationsDataTable
            applications={data.applications}
            onStatusChange={handleStatusChange}
            onNotesOpen={function (id) { setNotesAppId(id); }}
            readOnly={false}
            totalCount={data.total} page={data.page} pageSize={data.pageSize}
            onPageChange={function (p) { setParam("page", String(p)); }}
            sort={sort} order={order}
            onSort={function (col) {
              var next = new URLSearchParams(searchParams.toString());
              if (sort === col) next.set("order", order === "asc" ? "desc" : "asc");
              else { next.set("sort", col); next.delete("order"); }
              next.delete("page");
              router.push("?" + next.toString());
            }}
          />
        ) : loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--ink-soft)" }}>Loading...</div> : null}
      </div>

      {notesAppId && <ApplicationNotesModal applicationId={notesAppId} onClose={function () { setNotesAppId(null); }} />}
    </div>
  );
}
