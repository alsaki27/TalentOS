"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import StatCard from "@/components/StatCard";
import ApplicationStatusChart from "@/components/candidates/shared/ApplicationStatusChart";
import ApplicationSourceChart from "@/components/candidates/shared/ApplicationSourceChart";
import ApplicationsDataTable from "@/components/candidates/shared/ApplicationsDataTable";
import ApplicationNotesModal from "@/components/candidates/shared/ApplicationNotesModal";

interface CandidateOption {
  id: string;
  name: string;
  application_count: number;
}

interface DashboardRow {
  application_id: string;
  status: string;
  priority: string | null;
  applied_at: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  candidate_id: string;
  candidate_name: string;
  job_id: string;
  job_title: string;
  company_name: string;
  company_website: string | null;
  job_source: string;
  source_url: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  fit_score: number | null;
  recommendation: string | null;
  tailored_resume_version_id: string | null;
}

interface EmailTaskCounts {
  pendingApprovals: number;
  needsReply: number;
  interviews: number;
  untracked: number;
  total: number;
}

interface DashboardData {
  applications: DashboardRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  candidates: CandidateOption[];
  selectedCandidateName: string | null;
  emailTaskCounts: EmailTaskCounts;
}

var DISPLAY_GROUPS: Record<string, string> = {
  applied: "Applied", replied: "Screening", interview: "Interview",
  offer: "Offer", rejected: "Rejected", withdrawn: "Rejected",
  assigned: "Applied", stacked: "Applied", in_progress: "Applied",
};

var STATUS_ICONS: Record<string, string> = { Applied: "✅", Screening: "📞", Interview: "🎯", Offer: "🏆", Rejected: "❌" };

function CandidateDashboardInner() {
  var router = useRouter();
  var searchParams = useSearchParams();
  var [data, setData] = useState<DashboardData | null>(null);
  var [loading, setLoading] = useState(true);
  var [syncingEmails, setSyncingEmails] = useState(false);
  var [error, setError] = useState<string | null>(null);
  var [notesAppId, setNotesAppId] = useState<string | null>(null);

  var candidateId = searchParams.get("candidateId") || "";
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
    if (candidateId) params.set("candidateId", candidateId);
    if (search) params.set("search", search);
    if (statusGroup) params.set("statusGroup", statusGroup);
    if (source) params.set("source", source);
    if (page > 1) params.set("page", String(page));
    if (sort !== "applied_at") params.set("sort", sort);
    if (order !== "desc") params.set("order", order);

    fetch("/api/candidate-dashboard?" + params.toString())
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { setData(d); setLoading(false); })
      .catch(function (err) { setError(err.message ?? String(err)); setLoading(false); });
  }, [candidateId, search, statusGroup, source, page, sort, order]);

  useEffect(function () { fetchData(); }, [fetchData]);

  function setParam(key: string, value: string) {
    var next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page" && key !== "search") next.delete("page");
    router.push("/candidate-dashboard?" + next.toString());
  }

  function setParamMultiple(updates: Record<string, string>) {
    var next = new URLSearchParams(searchParams.toString());
    var wantsPageReset = false;
    for (var k in updates) { if (k !== "page" && k !== "search") wantsPageReset = true; if (updates[k]) next.set(k, updates[k]); else next.delete(k); }
    if (wantsPageReset) next.delete("page");
    router.push("/candidate-dashboard?" + next.toString());
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

  async function forceSyncEmails() {
    setSyncingEmails(true);
    try {
      var res = await fetch("/api/candidate-dashboard/force-sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      fetchData();
    } catch (err) {
      console.error("Force sync failed:", err);
      alert("Failed to force sync emails. Check console for details.");
    } finally {
      setSyncingEmails(false);
    }
  }

  var statusCounts = data?.statusCounts ?? {};
  var sourceCounts = data?.sourceCounts ?? {};
  var candidates = data?.candidates ?? [];

  var statusChartData = ["Applied", "Screening", "Interview", "Offer", "Rejected"].map(function (l) { return { label: l, count: statusCounts[l] || 0 }; });
  var sourceChartData = Object.keys(sourceCounts).sort().map(function (k) { return { label: k === "company_site" ? "Company Site" : k.charAt(0).toUpperCase() + k.slice(1), count: sourceCounts[k] }; });

  if (error) return <div style={{ color: "var(--danger)", padding: 20, background: "rgba(244,63,94,0.08)", borderRadius: 10, fontSize: 13, border: "1px solid var(--danger-soft, rgba(244,63,94,0.25))" }}>Failed to load dashboard: {error}. <button onClick={fetchData} style={{ color: "var(--danger)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Retry</button></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "var(--ink)", letterSpacing: "-0.5px" }}>
            Candidate Application Dashboard
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>
            Track, manage, and visualize multi-candidate job applications and screening pipelines
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={forceSyncEmails} disabled={syncingEmails || loading} style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)",
            cursor: (syncingEmails || loading) ? "not-allowed" : "pointer", opacity: (syncingEmails || loading) ? 0.6 : 1, transition: "all 0.15s",
          }}>
            {syncingEmails ? "Syncing..." : "📥 Force Sync Emails"}
          </button>
          <button onClick={fetchData} disabled={loading} style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent)",
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, transition: "all 0.15s",
          }}>
            {loading ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Candidate Selector */}
      <div className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 6 }}>
          👤 Candidate
        </span>
        <select
          value={candidateId}
          onChange={function (e) { var v = e.target.value; setParamMultiple({ candidateId: v, statusGroup: "", source: "" }); }}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg)", color: "var(--ink)", fontSize: 13, fontWeight: 600,
            outline: "none", cursor: "pointer", minWidth: 220, maxWidth: "100%",
          }}
        >
          <option value="">All Candidates ({candidates.reduce(function (s, c) { return s + c.application_count; }, 0)} applications)</option>
          {candidates.map(function (c) { return (
            <option key={c.id} value={c.id}>{c.name} ({c.application_count})</option>
          ); })}
        </select>
        {data?.selectedCandidateName && (
          <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, background: "var(--accent-soft)", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--accent)" }}>
            {data.selectedCandidateName}
            <button
              onClick={function () { setParamMultiple({ candidateId: "", statusGroup: "", source: "" }); }}
              style={{ marginLeft: 6, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 700, fontSize: 14, lineHeight: 1 }}
              title="Clear filter"
            >×</button>
          </span>
        )}
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {[
          { label: "Total", value: String(data?.total ?? 0), group: "" },
          { label: "Applied", value: String(statusCounts["Applied"] || 0), group: "Applied" },
          { label: "Screening", value: String(statusCounts["Screening"] || 0), group: "Screening" },
          { label: "Interview", value: String(statusCounts["Interview"] || 0), group: "Interview" },
          { label: "Offer", value: String(statusCounts["Offer"] || 0), group: "Offer" },
          { label: "Rejected", value: String(statusCounts["Rejected"] || 0), group: "Rejected" },
        ].map(function (card) { return (
          <div key={card.label} onClick={function () { setParamMultiple({ statusGroup: card.group, source: "" }); }} style={{ cursor: card.group ? "pointer" : "default", opacity: loading ? 0.7 : 1 }} title={card.group ? "Filter by " + card.group : ""}>
            <StatCard label={card.label} value={card.value} icon={STATUS_ICONS[card.label] ? <span style={{ fontSize: 18 }}>{STATUS_ICONS[card.label]}</span> : undefined} />
          </div>
        ); })}
      </div>

      {/* Email work queue — full list lives on /inbox now; this is just a
          counts summary + link, replacing what used to be every open
          action item rendered inline here with no truncation. */}
      {(data?.emailTaskCounts?.total ?? 0) > 0 && (
        <div className="card" style={{ padding: 18, border: "1px solid rgba(245,158,11,0.35)", borderRadius: 12, background: "linear-gradient(135deg, rgba(245,158,11,0.08), var(--surface))", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>Email work queue</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>
              {data?.emailTaskCounts.pendingApprovals ?? 0} need approval · {data?.emailTaskCounts.needsReply ?? 0} need a reply · {data?.emailTaskCounts.interviews ?? 0} interviews
            </p>
          </div>
          <Link
            href={candidateId ? `/inbox?candidateId=${candidateId}` : "/inbox"}
            className="btn-primary"
            style={{ textDecoration: "none" }}
          >
            Open Candidate Inbox →
          </Link>
        </div>
      )}

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 18, border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Application Status Distribution</h3>
          </div>
          <ApplicationStatusChart data={statusChartData} onSliceClick={function (label) { setParamMultiple({ statusGroup: label, source: "" }); }} activeLabel={statusGroup} />
        </div>
        <div className="card" style={{ padding: 18, border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📡</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Source Platform Breakdown</h3>
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
            totalCount={data.total}
            page={data.page}
            pageSize={data.pageSize}
            onPageChange={function (p) { setParam("page", String(p)); }}
            sort={sort} order={order}
            onSort={function (col) {
              var next = new URLSearchParams(searchParams.toString());
              if (sort === col) next.set("order", order === "asc" ? "desc" : "asc");
              else { next.set("sort", col); next.delete("order"); }
              next.delete("page");
              router.push("/candidate-dashboard?" + next.toString());
            }}
          />
        ) : loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--ink-soft)" }}>Loading...</div> : null}
      </div>

      {notesAppId && <ApplicationNotesModal applicationId={notesAppId} onClose={function () { setNotesAppId(null); }} />}
    </div>
  );
}

export default function CandidateDashboardPage() {
  return (
    <div className="page app-queue-page" style={{ maxWidth: 1600 }}>
      <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Loading dashboard...</div>}>
        <CandidateDashboardInner />
      </Suspense>
    </div>
  );
}
