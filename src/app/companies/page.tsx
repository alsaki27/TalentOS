"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BarChart from "@/components/BarChart";
import PieChart from "@/components/PieChart";
import StatCard from "@/components/StatCard";

interface CompanyListItem {
  id: string;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  logo_url: string | null;
  employees_count: number | null;
  slogan: string | null;
  source: string | null;
  last_seen_at: string | null;
  job_count: number;
  people_count: number;
  application_count: number;
  interview_count: number;
}

interface CompanyStats {
  topByApplications: { id: string; name: string; application_count: number }[];
  bySource: { source: string; count: number }[];
}

const PAGE_SIZE = 50;

const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "Company" },
  { key: "job_count", label: "Jobs" },
  { key: "people_count", label: "People" },
  { key: "application_count", label: "Applications" },
  { key: "interview_count", label: "Interviews" },
  { key: "last_seen_at", label: "Last seen" },
];

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [stats, setStats] = useState<CompanyStats>({ topByApplications: [], bySource: [] });
  const [sources, setSources] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [minApplications, setMinApplications] = useState("");
  const [minJobs, setMinJobs] = useState("");
  const [sort, setSort] = useState("last_seen_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function load(pageNum = page) {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(pageNum),
      pageSize: String(PAGE_SIZE),
      sort,
      order,
    });
    if (search) params.set("search", search);
    if (source) params.set("source", source);
    if (minApplications) params.set("minApplications", minApplications);
    if (minJobs) params.set("minJobs", minJobs);
    const res = await fetch(`/api/companies?${params}`);
    const data = await res.json();
    setCompanies(data.companies ?? []);
    setTotal(data.total ?? 0);
    setSources(data.sources ?? []);
    setStats(data.stats ?? { topByApplications: [], bySource: [] });
    setPage(pageNum);
    setLoading(false);
  }

  useEffect(() => { load(1); }, [search, source, minApplications, minJobs, sort, order]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(search || source || minApplications || minJobs);

  function toggleSort(key: string) {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder(key === "name" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: string) {
    if (sort !== key) return null;
    return <span style={{ marginLeft: 4, opacity: 0.7 }}>{order === "asc" ? "▲" : "▼"}</span>;
  }

  const topApplicationsData = stats.topByApplications.map((c) => ({ label: c.name, value: c.application_count }));
  const bySourceData = stats.bySource.map((s) => ({ label: s.source, value: s.count }));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Companies</h1>
          <div className="page-kicker">Company profiles, past jobs, and influential people from imports.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Companies" value={total} />
        <StatCard label="With applications (page)" value={companies.filter((c) => c.application_count > 0).length} />
        <StatCard label="Jobs (page)" value={companies.reduce((s, c) => s + c.job_count, 0)} />
        <StatCard label="Applications (page)" value={companies.reduce((s, c) => s + c.application_count, 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h2 className="section-title">Top companies by applications</h2>
          {topApplicationsData.length === 0 ? (
            <div className="empty">No applications linked to companies yet.</div>
          ) : (
            <BarChart data={topApplicationsData} orientation="horizontal" />
          )}
        </div>
        <div className="card">
          <h2 className="section-title">Companies by source</h2>
          {bySourceData.length === 0 ? (
            <div className="empty">No source data.</div>
          ) : (
            <PieChart data={bySourceData} />
          )}
        </div>
      </div>

      <div className="workflow-panel">
        <div className="filter-bar">
          <input placeholder="Search companies..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            placeholder="Min applications"
            value={minApplications}
            onChange={(e) => setMinApplications(e.target.value)}
            style={{ width: 140 }}
          />
          <input
            type="number"
            min={0}
            placeholder="Min jobs"
            value={minJobs}
            onChange={(e) => setMinJobs(e.target.value)}
            style={{ width: 110 }}
          />
          {hasFilters && (
            <button onClick={() => { setSearchInput(""); setSearch(""); setSource(""); setMinApplications(""); setMinJobs(""); }}>
              Clear filters
            </button>
          )}
          <span className="muted" style={{ fontSize: 12 }}>{companies.length} of {total}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-panel">Loading companies...</div>
      ) : companies.length === 0 ? (
        <div className="empty">No companies match these filters.</div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                {SORT_COLUMNS.map((col) => (
                  <th key={col.key} onClick={() => toggleSort(col.key)} style={{ cursor: "pointer", userSelect: "none" }}>
                    {col.label}{sortIndicator(col.key)}
                  </th>
                ))}
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td className="cell-main">
                    <Link className="row-link" href={`/companies/${company.id}`}>{company.name}</Link>
                    {company.slogan && <div className="muted" style={{ fontSize: 12 }}>{company.slogan}</div>}
                    {company.source && <span className="badge">{company.source}</span>}
                  </td>
                  <td>{company.job_count}</td>
                  <td>{company.people_count}</td>
                  <td>{company.application_count}</td>
                  <td>{company.interview_count}</td>
                  <td className="muted">{company.last_seen_at ? new Date(company.last_seen_at).toLocaleDateString() : "-"}</td>
                  <td>
                    <div className="action-group">
                      {company.website && <a href={company.website} target="_blank" rel="noreferrer">Website</a>}
                      {company.linkedin_url && <a href={company.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination-bar">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page === 1}>Previous</button>
        <span className="muted">Page {page} of {totalPages}</span>
        <button onClick={() => load(page + 1)} disabled={loading || page >= totalPages}>Next</button>
      </div>
    </>
  );
}
