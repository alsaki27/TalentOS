"use client";

import type { ReactNode } from "react";

export interface PortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  submitted_at: string | null;
  updated_at: string | null;
  job: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    source: string | null;
    source_url: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    salary_period: string | null;
    salary_range: string | null;
  } | null;
  resume: {
    id: string | null;
    status: "all" | "ready" | "generating" | "unavailable";
    title: string | null;
    version_label: string | null;
    generated_at: string | null;
  };
  next_action: string | null;
  follow_up_at: string | null;
  interview: { status: "all" | "upcoming" | "completed" | "cancelled" | "not_scheduled"; scheduled_at: string | null };
  needs_attention: boolean;
}

export interface PortalDashboardFilters {
  search: string;
  status: string;
  source: string;
  dateRange: string;
  dateFrom: string;
  dateTo: string;
  resumeStatus: string;
  interviewStatus: string;
  needsAttention: boolean;
  sort: string;
  order: string;
  page: number;
}

interface Props {
  applications: PortalApplication[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sourceCounts: Record<string, number>;
  filters: PortalDashboardFilters;
  loading: boolean;
  onFiltersChange: (next: Partial<PortalDashboardFilters>) => void;
}

const STAGE_META: Record<string, { color: string; bg: string; icon: string }> = {
  submitted: { color: "#6b7280", bg: "#f1f2f5", icon: "●" },
  waiting: { color: "#122461", bg: "#eef0f8", icon: "↻" },
  interview: { color: "#b45309", bg: "#fef3e2", icon: "◆" },
  offer: { color: "#c2415a", bg: "#ffeced", icon: "★" },
  closed: { color: "#9ca3af", bg: "#f1f2f5", icon: "○" },
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function sourceLabel(source: string | null) {
  if (!source) return "Unknown source";
  return source === "company_site" ? "Company site" : source.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resumeLabel(status: PortalApplication["resume"]["status"]) {
  if (status === "ready") return { text: "Resume ready", color: "#166534", bg: "#dcfce7" };
  if (status === "generating") return { text: "Resume generating", color: "#92400e", bg: "#fef3c7" };
  return { text: "Resume pending", color: "#6b7280", bg: "#f1f2f5" };
}

function salaryLabel(job: PortalApplication["job"]) {
  if (!job) return null;
  if (job.salary_min == null && job.salary_max == null) return job.salary_range || null;
  const currency = job.salary_currency || "";
  const range = `${job.salary_min ?? "?"}${job.salary_max != null ? `-${job.salary_max}` : ""}`;
  return `${currency} ${range}${job.salary_period ? `/${job.salary_period}` : ""}`.trim();
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="portal-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export default function CandidatePortalApplications({ applications, total, page, pageSize, totalPages, sourceCounts, filters, loading, onFiltersChange }: Props) {
  return (
    <section className="portal-section" aria-labelledby="applications-heading">
      <div className="portal-section-heading">
        <div>
          <div className="portal-eyebrow">Your pipeline</div>
          <h2 id="applications-heading" className="portal-section-heading-title">Applications</h2>
        </div>
        <span className="portal-count-badge">{total} total</span>
      </div>

      <div className="portal-filter-panel">
        <label className="portal-search-field">
          <span className="portal-sr-only">Search applications</span>
          <span aria-hidden="true">⌕</span>
          <input
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value, page: 1 })}
            placeholder="Search role, company, or location"
          />
        </label>
        <FilterSelect label="Stage" value={filters.status} onChange={(value) => onFiltersChange({ status: value, page: 1 })}>
          <option value="">All stages</option>
          <option value="Applied">Applied</option>
          <option value="Screening">Screening</option>
          <option value="Interview">Interview</option>
          <option value="Offer">Offer</option>
          <option value="Rejected">Closed</option>
        </FilterSelect>
        <FilterSelect label="Date" value={filters.dateRange} onChange={(value) => onFiltersChange({ dateRange: value, page: 1 })}>
          <option value="all">Any date</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="custom">Custom range</option>
        </FilterSelect>
        {filters.dateRange === "custom" && <>
          <label className="portal-filter-field"><span>From</span><input type="date" value={filters.dateFrom} onChange={(event) => onFiltersChange({ dateFrom: event.target.value, page: 1 })} /></label>
          <label className="portal-filter-field"><span>To</span><input type="date" value={filters.dateTo} onChange={(event) => onFiltersChange({ dateTo: event.target.value, page: 1 })} /></label>
        </>}
        <FilterSelect label="Source" value={filters.source} onChange={(value) => onFiltersChange({ source: value, page: 1 })}>
          <option value="">All sources</option>
          {Object.entries(sourceCounts).map(([source, count]) => <option key={source} value={source}>{sourceLabel(source)} ({count})</option>)}
        </FilterSelect>
        <FilterSelect label="Resume" value={filters.resumeStatus} onChange={(value) => onFiltersChange({ resumeStatus: value, page: 1 })}>
          <option value="all">Any resume status</option>
          <option value="ready">Resume ready</option>
          <option value="generating">Generating</option>
          <option value="unavailable">Not generated</option>
        </FilterSelect>
        <FilterSelect label="Interview" value={filters.interviewStatus} onChange={(value) => onFiltersChange({ interviewStatus: value, page: 1 })}>
          <option value="all">Any interview status</option>
          <option value="upcoming">Upcoming</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="not_scheduled">Not scheduled</option>
        </FilterSelect>
        <FilterSelect label="Attention" value={filters.needsAttention ? "true" : "false"} onChange={(value) => onFiltersChange({ needsAttention: value === "true", page: 1 })}>
          <option value="false">All applications</option>
          <option value="true">Needs attention</option>
        </FilterSelect>
        <FilterSelect label="Sort" value={`${filters.sort}:${filters.order}`} onChange={(value) => {
          const [sort, order] = value.split(":");
          onFiltersChange({ sort, order, page: 1 });
        }}>
          <option value="submitted_at:desc">Newest first</option>
          <option value="submitted_at:asc">Oldest first</option>
          <option value="updated_at:desc">Recently updated</option>
          <option value="company_name:asc">Company A–Z</option>
          <option value="job_title:asc">Role A–Z</option>
          <option value="status:asc">Stage</option>
        </FilterSelect>
      </div>

      {loading && applications.length === 0 ? (
        <div className="portal-list" aria-label="Loading applications">
          {[1, 2, 3].map((item) => <div className="portal-skeleton portal-application-skeleton" key={item} />)}
        </div>
      ) : applications.length === 0 ? (
        <div className="portal-empty">
          <div className="portal-empty-icon">▱</div>
          <strong>No applications match these filters.</strong>
          <span>Try clearing a filter or search term.</span>
          <button className="portal-btn portal-btn-secondary" onClick={() => onFiltersChange({ search: "", status: "", source: "", dateRange: "all", dateFrom: "", dateTo: "", resumeStatus: "all", interviewStatus: "all", needsAttention: false, sort: "submitted_at", order: "desc", page: 1 })}>Clear filters</button>
        </div>
      ) : (
        <div className={`portal-list ${loading ? "portal-list-loading" : ""}`}>
          {applications.map((application, index) => {
            const meta = STAGE_META[application.public_status.stage] ?? STAGE_META.submitted;
            const resume = resumeLabel(application.resume.status);
            return (
              <article key={application.id} className={`portal-app-card portal-stagger-${Math.min(index + 1, 4)}`}>
                <div className="portal-app-top">
                  <div className="portal-app-main">
                    <h3 className="portal-app-title">{application.job?.title ?? "Application"}</h3>
                    <div className="portal-app-company">{application.job?.company ?? "Company unavailable"}</div>
                    <div className="portal-app-meta">
                      {application.job?.location && <span>{application.job.location}</span>}
                      <span>{sourceLabel(application.job?.source ?? null)}</span>
                      <span>Submitted {formatDate(application.submitted_at)}</span>
                      {salaryLabel(application.job) && <span>{salaryLabel(application.job)}</span>}
                      <span>Updated {formatDate(application.updated_at)}</span>
                    </div>
                  </div>
                  <span className="portal-pill" style={{ color: meta.color, background: meta.bg }}>
                    <span aria-hidden="true">{meta.icon}</span>{application.public_status.label}
                  </span>
                </div>
                <div className="portal-app-footer">
                  <span className="portal-resume-pill" style={{ color: resume.color, background: resume.bg }}>{resume.text}</span>
                  {application.interview.status !== "not_scheduled" && <span className="portal-next-action">Interview: {application.interview.status}</span>}
                  {application.needs_attention && <span className="portal-attention-pill">Needs attention</span>}
                  {application.next_action && <span className="portal-next-action">Next: {application.next_action}</span>}
                  {application.follow_up_at && <span className="portal-next-action">Follow up {formatDate(application.follow_up_at)}</span>}
                  <a className="portal-btn portal-btn-small portal-btn-secondary" href={`/portal/applications/${application.id}`}>View details</a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="portal-pagination" aria-label="Application pages">
          <span>Page {page} of {totalPages}</span>
          <div className="portal-pagination-actions">
            <button className="portal-page-btn" disabled={page <= 1 || loading} onClick={() => onFiltersChange({ page: 1 })}>First</button>
            <button className="portal-page-btn" disabled={page <= 1 || loading} onClick={() => onFiltersChange({ page: page - 1 })}>Previous</button>
            <span className="portal-page-current">{page}</span>
            <button className="portal-page-btn" disabled={page >= totalPages || loading} onClick={() => onFiltersChange({ page: page + 1 })}>Next</button>
            <button className="portal-page-btn" disabled={page >= totalPages || loading} onClick={() => onFiltersChange({ page: totalPages })}>Last</button>
          </div>
          <span>{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}</span>
        </nav>
      )}
    </section>
  );
}
