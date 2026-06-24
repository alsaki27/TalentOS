"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
}

const PAGE_SIZE = 50;

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function load(pageNum = page) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pageNum), pageSize: String(PAGE_SIZE) });
    if (search) params.set("search", search);
    const res = await fetch(`/api/companies?${params}`);
    const data = await res.json();
    setCompanies(data.companies ?? []);
    setTotal(data.total ?? 0);
    setPage(pageNum);
    setLoading(false);
  }

  useEffect(() => { load(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Companies</h1>
          <div className="page-kicker">Company profiles, past jobs, and influential people from imports.</div>
        </div>
      </div>

      <div className="workflow-panel">
        <div className="filter-bar">
          <input placeholder="Search companies..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          {search && <button onClick={() => { setSearchInput(""); setSearch(""); }}>Clear</button>}
          <span className="muted" style={{ fontSize: 12 }}>{companies.length} of {total}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-panel">Loading companies...</div>
      ) : companies.length === 0 ? (
        <div className="empty">No companies yet. Import or add jobs with company names to build this directory.</div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Company</th>
                <th>Jobs</th>
                <th>People</th>
                <th>Links</th>
                <th>Last seen</th>
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
                  <td>
                    <div className="action-group">
                      {company.website && <a href={company.website} target="_blank" rel="noreferrer">Website</a>}
                      {company.linkedin_url && <a href={company.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                    </div>
                  </td>
                  <td className="muted">{company.last_seen_at ? new Date(company.last_seen_at).toLocaleDateString() : "-"}</td>
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
