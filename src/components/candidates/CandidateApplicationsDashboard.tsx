"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronRight, Copy, ExternalLink, FileText } from "lucide-react";
import { openFaloodStudio } from "@/lib/falood/openStudio";
import ApplicationStatusChart from "./shared/ApplicationStatusChart";
import ApplicationSourceChart from "./shared/ApplicationSourceChart";
import styles from "./CandidateApplicationWorkspace.module.css";

export interface CandidateApplicationRow {
  application_id: string;
  job_id: string;
  status_group: string;
  source_type: string | null;
  job_source: string;
  source_url: string | null;
  job_title: string;
  company_name: string;
  location: string | null;
  applied_at: string | null;
  next_action: string | null;
  tailored_resume_version_id: string | null;
  sharepoint_resume_url: string | null;
  application_resume_url: string | null;
  application_resume_filename: string | null;
  interview_stages: { round_number: number }[] | null;
  has_preparation: boolean;
}

interface DashboardData {
  applications: CandidateApplicationRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
}

const statusGroups = ["All", "Applied", "In Progress", "Screening", "Interview", "Offer", "Rejected"];
const statusIcons: Record<string, string> = {
  Applied: "✅", "In Progress": "⌛", Screening: "📞", Interview: "🎯", Offer: "🏆", Rejected: "❌",
};

function shortId(value: string) {
  return value.slice(0, 8).toUpperCase();
}

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function sourceLabel(row: CandidateApplicationRow) {
  if (row.source_type === "custom_interview") return "Custom interview";
  const source = (row.job_source || "Unknown").replace(/[_-]+/g, " ");
  return source[0].toUpperCase() + source.slice(1);
}

export default function CandidateApplicationsDashboard({ candidateId, customInterviewOnly = false, refreshToken = 0, onCustomInterviewEdit, onCustomInterviewRemove }: {
  candidateId: string;
  customInterviewOnly?: boolean;
  refreshToken?: number;
  onCustomInterviewEdit?: (application: CandidateApplicationRow) => void;
  onCustomInterviewRemove?: (application: CandidateApplicationRow) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("statusGroup") || "Interview";
  const source = searchParams.get("source") || "";
  const search = searchParams.get("search") || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const sort = searchParams.get("sort") || "applied_at";
  const order = searchParams.get("order") || "desc";
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [copiedJob, setCopiedJob] = useState("");
  const candidatePath = "/candidates/" + candidateId;

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "25", search, source, sort, order });
    if (customInterviewOnly) params.set("sourceType", "custom_interview");
    if (status !== "All") params.set("statusGroup", status);
    fetch("/api" + candidatePath + "/applications/dashboard?" + params, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load application records.");
        return response.json();
      })
      .then((result: DashboardData) => { if (!abort.signal.aborted) setData(result); })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [attempt, candidatePath, customInterviewOnly, order, page, refreshToken, search, sort, source, status]);

  function updateFilters(values: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    if (!("page" in values)) next.delete("page");
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(candidatePath + (next.size ? "?" + next.toString() : ""), { scroll: false });
  }

  const sources = Object.entries(data?.sourceCounts ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const statusChart = statusGroups.filter((value) => value !== "All").map((label) => ({ label, count: data?.statusCounts[label] ?? 0 }));
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  const returnParams = new URLSearchParams(searchParams.toString());
  if (customInterviewOnly) returnParams.set("tab", "Custom Interview");
  else returnParams.delete("tab");
  const returnFilters = returnParams.toString();
  const totalApplications = sources.reduce((sum, [, count]) => sum + count, 0);

  function sortHeader(label: string, column: string) {
    return <th scope="col" aria-sort={sort === column ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={styles.sortHeader}
        onClick={() => updateFilters({ sort: column, order: sort === column && order === "asc" ? "desc" : "asc" })}>
        {label} {sort !== column ? <ArrowUpDown size={12} /> : order === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      </button>
    </th>;
  }

  return (
    <div className={styles.stack}>
        <div className={styles.summaryGrid} role="group" aria-label="Quick application status filters">
          {statusGroups.map((group) => (
            <button key={group} type="button" aria-pressed={status === group}
              className={styles.summaryCard}
              onClick={() => updateFilters({ statusGroup: group === "Interview" ? "" : group })}>
              {statusIcons[group] && <span className={styles.summaryIcon} aria-hidden="true">{statusIcons[group]}</span>}
              <span><span className="stat-label">{group === "All" ? "Total" : group}</span>
                <strong className="stat-value">{data ? (group === "All" ? totalApplications : data.statusCounts[group] ?? 0).toLocaleString() : "—"}</strong></span>
            </button>
          ))}
        </div>
        {data && <div className={styles.chartGrid} aria-label="Application analytics">
          <section className={styles.card}>
            <h2>Status distribution</h2>
            <ApplicationStatusChart data={statusChart} onSliceClick={(label) => updateFilters({ statusGroup: label, source: "" })} activeLabel={status} />
          </section>
          <section className={styles.card}>
            <h2>Source breakdown</h2>
            <ApplicationSourceChart data={sources.map(([label, count]) => ({ label, count }))}
              onBarClick={(label) => updateFilters({ source: label, statusGroup: "All" })} activeSource={source} />
          </section>
        </div>}
        <form className={styles.filterGrid} onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: String(new FormData(event.currentTarget).get("search") ?? "").trim() });
        }}>
          <label className={styles.filterField}><span>Search applications</span><span className={styles.searchControl}>
            <input key={search} name="search" defaultValue={search} aria-label="Search applications" placeholder="Company, role or location" />
            <button type="submit">Search</button>
          </span></label>
          <label className={styles.filterField}><span>Status</span><select aria-label="Filter by status" value={status} onChange={(event) => updateFilters({ statusGroup: event.target.value === "Interview" ? "" : event.target.value })}>
            {statusGroups.map((group) => <option key={group} value={group}>{group === "Interview" ? "Interviews" : group === "All" ? "All applications" : group}</option>)}
          </select></label>
          <label className={styles.filterField}><span>Source</span><select aria-label="Filter by source" value={source} onChange={(event) => updateFilters({ source: event.target.value })}>
            <option value="">All sources</option>
            {sources.map(([label]) => <option key={label} value={label}>{label.replace(/_/g, " ")}</option>)}
          </select></label>
          <label className={styles.filterField}><span>Sort by</span><select aria-label="Sort applications" value={sort + ":" + order} onChange={(event) => {
            const [nextSort, nextOrder] = event.target.value.split(":");
            updateFilters({ sort: nextSort, order: nextOrder });
          }}>
            <option value="applied_at:desc">Newest applied</option><option value="applied_at:asc">Oldest applied</option>
            <option value="company_name:asc">Company A–Z</option><option value="job_title:asc">Role A–Z</option>
            <option value="status:asc">By status</option><option value="fit_score:desc">Highest fit</option>
          </select></label>
          {search && <button className={styles.clearFilter} type="button" onClick={() => updateFilters({ search: "" })}>Clear search</button>}
        </form>
      <section className={styles.card + " " + styles.stack} aria-busy={loading}>
        <div className={styles.recordsHeading}>
          <h2>{customInterviewOnly ? "Custom Interview Records" : "Application Records"}</h2>
          <span className={styles.statusBadge}>{loading ? "Loading…" : error ? "Unavailable" : (data?.total ?? 0).toLocaleString()}</span>
        </div>
        {error && <div role="alert" className={styles.toolbar}><p className={styles.error}>{error}</p><button onClick={() => setAttempt((count) => count + 1)}>Retry</button></div>}
        {!error && !loading && data && (
          <>
            {!data.applications.length && <p className={styles.muted}>{status === "Interview" ? "No interview applications match these filters." : "No applications match these filters."}</p>}
            {!!data.applications.length && <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Application Records table">
              <table className={styles.recordsTable}>
                <thead><tr>
                  {sortHeader("Company", "company_name")}
                  {sortHeader("Job role", "job_title")}
                  <th scope="col">Job ID</th><th scope="col">Source</th><th scope="col">Location</th><th scope="col">Resume</th>
                  {sortHeader("Status", "status")}
                  <th scope="col">Interview</th><th scope="col">Prep docs</th>
                  {sortHeader("Applied", "applied_at")}
                  <th scope="col">Next action</th>
                  <th scope="col">Actions</th>
                </tr></thead>
                <tbody>
              {data.applications.map((row) => {
                const postingUrl = safeExternalUrl(row.source_url);
                const resumeUrl = safeExternalUrl(row.application_resume_url);
                const sharepointUrl = safeExternalUrl(row.sharepoint_resume_url);
                const interviewStageCount = row.interview_stages?.length ?? 0;
                const lastRound = row.interview_stages?.reduce((latest, item) => Math.max(latest, item.round_number), 0);
                return (
                  <tr key={row.application_id}>
                    <td>{postingUrl ? <a className={styles.companyLink} href={postingUrl} target="_blank" rel="noreferrer" title="Open job posting">{row.company_name}</a> : row.company_name}</td>
                    <td><strong>{row.job_title}</strong></td>
                    <td><button type="button" className={styles.jobId} title={`Copy ${row.job_id}`} aria-label={`Copy job ID ${row.job_id}`}
                      onClick={() => navigator.clipboard?.writeText(row.job_id).then(() => setCopiedJob(row.job_id), () => setCopiedJob(""))}>
                      {shortId(row.job_id)} {copiedJob === row.job_id ? <Check size={13} /> : <Copy size={13} />}
                    </button></td>
                    <td className={styles.sourceColumn}>{sourceLabel(row)}</td>
                    <td>{row.location || "—"}</td>
                    <td><div className={styles.resumeLinks}>
                      {row.tailored_resume_version_id && <button type="button" className={styles.studioLink}
                        onClick={() => { if (row.tailored_resume_version_id) void openFaloodStudio("application_resume_version", row.tailored_resume_version_id); }}>
                        <FileText size={13} /> Studio
                      </button>}
                      {sharepointUrl && <a href={sharepointUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> SharePoint</a>}
                      {!sharepointUrl && resumeUrl && <a href={resumeUrl} target="_blank" rel="noreferrer" title={row.application_resume_filename || "Application resume"}>
                        <FileText size={13} /> Resume file
                      </a>}
                      {!row.tailored_resume_version_id && !resumeUrl && !sharepointUrl && "—"}
                    </div></td>
                    <td><span className={styles.tableStatus} data-status={row.status_group}>{row.status_group}</span></td>
                    <td>{interviewStageCount > 0 ? <span className={styles.interviewCount}>
                      <strong>{interviewStageCount} {interviewStageCount === 1 ? "stage" : "stages"}</strong>
                      {!!lastRound && <small>Stage {lastRound}</small>}
                    </span> : "—"}</td>
                    <td><span className={styles.prepIndicator} data-ready={row.has_preparation}>
                      <span aria-hidden="true">{row.has_preparation && <Check size={12} />}</span>
                      {row.has_preparation ? "Yes" : "No"}
                    </span></td>
                    <td>{dateLabel(row.applied_at)}</td>
                    <td className={styles.recordNextAction}>{row.next_action?.trim() || "—"}</td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link className={styles.linkButton} href={candidatePath + "/applications/" + row.application_id +
                        (returnFilters ? "?from=" + encodeURIComponent(returnFilters) : "")}
                        aria-label={"Details for " + row.job_title + " at " + row.company_name}>Show details <ChevronRight size={14} /></Link>
                      {customInterviewOnly && onCustomInterviewEdit && <button type="button" className={styles.linkButton}
                        onClick={() => onCustomInterviewEdit(row)} aria-label={"Edit custom interview " + row.job_title}>Edit</button>}
                      {customInterviewOnly && onCustomInterviewRemove && <button type="button" className={styles.linkButton}
                        onClick={() => onCustomInterviewRemove(row)} aria-label={"Remove custom interview " + row.job_title}>Remove</button>}
                    </div></td>
                  </tr>
                );
              })}
                </tbody>
              </table>
            </div>}
            {(pageCount > 1 || page > 1) && <div className={styles.pagination}>
              <span className={styles.muted}>{data.total.toLocaleString()} total · Page {page} of {pageCount}</span>
              <div className={styles.paginationButtons}>
                <button disabled={page <= 1} onClick={() => updateFilters({ page: "1" })}>« First</button>
                <button disabled={page <= 1} onClick={() => updateFilters({ page: String(page - 1) })}>‹ Prev</button>
                {Array.from({ length: Math.min(pageCount, 5) }, (_, index) => {
                  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
                  const number = start + index;
                  return number <= pageCount ? <button key={number} aria-current={number === page ? "page" : undefined}
                    className={number === page ? styles.pageNumberActive : styles.pageNumber}
                    onClick={() => updateFilters({ page: String(number) })}>{number}</button> : null;
                })}
                <button disabled={page >= pageCount} onClick={() => updateFilters({ page: String(page + 1) })}>Next ›</button>
                <button disabled={page >= pageCount} onClick={() => updateFilters({ page: String(pageCount) })}>Last »</button>
              </div>
            </div>}
          </>
        )}
      </section>
    </div>
  );
}
