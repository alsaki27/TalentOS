"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./extension-reports.module.css";

type TeamMember = { user_id: string; display_name: string | null; email: string | null; role: string; is_active: boolean };
type CandidateOption = { candidate_id: string; candidate_name: string };
type Aggregate = {
  actor_user_id: string;
  period?: string;
  display_name: string | null;
  email: string | null;
  jobs_added: number;
  duplicate_captures: number;
  candidates_logged: number;
  applications_reviewed: number;
  applications_applied: number;
};
type EventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_name: string | null;
  actor_email: string;
  job_title: string | null;
  job_company: string | null;
  job_id: string | null;
  job_location: string | null;
  candidate_name: string | null;
  base_resume_name: string | null;
  application_id: string | null;
  metadata: Record<string, unknown> | null;
};
type ReportResponse = {
  teamMembers: TeamMember[];
  candidates: CandidateOption[];
  totals: Record<string, number>;
  teamTotals: Aggregate[];
  activityBreakdown: Aggregate[];
  events: EventRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type RangePreset = "today" | "last24" | "last3" | "last7" | "last15" | "last30" | "custom";

const countFields = [
  ["jobs_added", "Jobs added", "job_added"],
  ["duplicate_captures", "Duplicate captures", "job_duplicate"],
  ["candidates_logged", "Candidates logged", "candidate_logged"],
  ["applications_reviewed", "Reviews completed", "application_reviewed"],
  ["applications_applied", "Marked as applied", "application_applied"],
] as const satisfies ReadonlyArray<readonly [keyof Aggregate, string, string]>;

const eventNames: Record<string, string> = {
  job_added: "Job added",
  job_duplicate: "Duplicate capture",
  candidate_logged: "Candidate logged",
  application_reviewed: "Review stage completed",
  application_applied: "Application marked applied",
};

function dhakaInputValue(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

const fmtDate = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", dateStyle: "medium" }).format(new Date(value));
const fmtDhakaDay = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
const fmtTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const fmtDhakaInput = (value: string) => {
  const [date, time] = value.split("T");
  const utcWallTime = new Date(`${date}T${time}:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(utcWallTime);
};
const number = (value: unknown) => Number(value || 0).toLocaleString("en-US");

function emptyAggregate(member: TeamMember): Aggregate {
  return {
    actor_user_id: member.user_id,
    display_name: member.display_name,
    email: member.email,
    jobs_added: 0,
    duplicate_captures: 0,
    candidates_logged: 0,
    applications_reviewed: 0,
    applications_applied: 0,
  };
}

export default function ExtensionReportsPage() {
  const [role, setRole] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [rangePreset, setRangePreset] = useState<RangePreset>("last24");
  const [memberId, setMemberId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [eventType, setEventType] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [teamTotals, setTeamTotals] = useState<Aggregate[]>([]);
  const [activityBreakdown, setActivityBreakdown] = useState<Aggregate[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [pagination, setPagination] = useState<ReportResponse["pagination"]>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadController = useRef<AbortController | null>(null);

  useEffect(() => {
    const now = new Date();
    setStartAt(dhakaInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    setEndAt(dhakaInputValue(now));
    void fetch("/api/bootstrap", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => setRole(body?.profile?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (!startAt || !endAt) {
      setLoading(false);
      setError("Choose both a start and end date/time to load this report.");
      setTeamTotals([]);
      setActivityBreakdown([]);
      setEvents([]);
      setTotals({});
      setPagination({ page: 1, pageSize, total: 0, totalPages: 0 });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startAt, endAt, page: String(page), pageSize: String(pageSize) });
      if (memberId) params.set("memberId", memberId);
      if (candidateId) params.set("candidateId", candidateId);
      if (eventType) params.set("eventType", eventType);
      const response = await fetch(`/api/admin/extension-reports?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load report.");
      if (controller.signal.aborted) return;
      setTeamMembers(body.teamMembers || []);
      setCandidates(body.candidates || []);
      setTeamTotals(body.teamTotals || []);
      setActivityBreakdown(body.activityBreakdown || []);
      setEvents(body.events || []);
      setTotals(body.totals || {});
      setPagination(body.pagination || { page, pageSize, total: 0, totalPages: 0 });
      if (body.pagination?.page && body.pagination.page !== page) setPage(body.pagination.page);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setTeamTotals([]);
        setActivityBreakdown([]);
        setEvents([]);
        setTotals({});
        setPagination({ page: 1, pageSize, total: 0, totalPages: 0 });
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [startAt, endAt, memberId, candidateId, eventType, page, pageSize]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const filteredMemberTotals = useMemo(() => {
    const totalsByMember = new Map(teamTotals.map((row) => [row.actor_user_id, row]));
    const visibleMembers = memberId ? teamMembers.filter((member) => member.user_id === memberId) : teamMembers;
    return visibleMembers
      .map((member) => totalsByMember.get(member.user_id) ?? emptyAggregate(member))
      .sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || ""));
  }, [memberId, teamMembers, teamTotals]);

  const selectedRangeLabel = startAt && endAt
    ? `${fmtDhakaInput(startAt)} – ${fmtDhakaInput(endAt)} · Asia/Dhaka`
    : "Loading date range…";

  function applyRangePreset(preset: RangePreset) {
    setRangePreset(preset);
    if (preset === "custom") return;
    const now = new Date();
    const current = dhakaInputValue(now);
    setEndAt(current);
    if (preset === "today") {
      setStartAt(`${current.slice(0, 10)}T00:00`);
    } else {
      const days = preset === "last24" ? 1 : Number(preset.slice(4));
      setStartAt(dhakaInputValue(new Date(now.getTime() - days * 24 * 60 * 60 * 1000)));
    }
    setPage(1);
  }

  function clearFilters() {
    setMemberId("");
    setCandidateId("");
    setEventType("");
    applyRangePreset("last24");
  }

  function changeFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
    setPageInput("");
    setPageError("");
  }

  function goToPage(inputValue: string) {
    const requestedPage = Number.parseInt(inputValue, 10);
    const totalPages = pagination.totalPages;
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      setPageError("Enter a valid page number");
      return;
    }
    if (requestedPage > totalPages) {
      setPageError(`Page must be 1–${totalPages}`);
      return;
    }
    setPageError("");
    setPageInput("");
    setPage(requestedPage);
  }

  if (role && role !== "admin") return <p className="form-error" style={{ padding: 24 }}>This report is available to admins only.</p>;

  return <div className={`extension-reports-page ${styles.page}`}>
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>TEAM OPERATIONS</span>
        <h1>Extension activity reports</h1>
        <p>Review verified job captures, candidate logging, resume work, reviews, and application updates across the team.</p>
      </div>
    </header>

    <section className={styles.filterPanel} aria-label="Report filters">
      <div className={styles.filterHeading}>
        <div><h2>Report filters</h2><p>Counts and action details use this date range. Times are in Asia/Dhaka.</p></div>
        <span className={styles.rangeBadge}>{selectedRangeLabel}</span>
      </div>
      <div className={styles.filterGrid}>
        <label className={styles.field}>Start date and time
          <input className="input" type="datetime-local" value={startAt} onChange={(event) => { setRangePreset("custom"); changeFilter(setStartAt, event.target.value); }} />
        </label>
        <label className={styles.field}>End date and time
          <input className="input" type="datetime-local" value={endAt} onChange={(event) => { setRangePreset("custom"); changeFilter(setEndAt, event.target.value); }} />
        </label>
        <label className={styles.field}>Team member
          <select className="input" value={memberId} onChange={(event) => changeFilter(setMemberId, event.target.value)}>
            <option value="">All team members</option>
            {teamMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.user_id === "deleted-member" ? "Deleted member · historical activity" : `${member.display_name || member.email} · ${member.role.replaceAll("_", " ")}${member.is_active ? "" : " (inactive)"}`}</option>)}
          </select>
        </label>
        <label className={styles.field}>Candidate
          <select className="input" value={candidateId} onChange={(event) => changeFilter(setCandidateId, event.target.value)}>
            <option value="">All candidates</option>
            {candidates.map((candidate) => <option key={candidate.candidate_id} value={candidate.candidate_id}>{candidate.candidate_name}</option>)}
          </select>
        </label>
        <label className={styles.field}>Action type
          <select className="input" value={eventType} onChange={(event) => changeFilter(setEventType, event.target.value)}>
            <option value="">All actions</option>
            {countFields.map(([, label, type]) => <option key={type} value={type}>{label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Quick range
          <select className="input" value={rangePreset} onChange={(event) => applyRangePreset(event.target.value as RangePreset)}>
            <option value="today">Today</option>
            <option value="last24">Last 24 hours</option>
            <option value="last3">Last 3 days</option>
            <option value="last7">Last 7 days</option>
            <option value="last15">Last 15 days</option>
            <option value="last30">Last 30 days</option>
            <option value="custom">Custom date range</option>
          </select>
        </label>
      </div>
      <div className={styles.filterFooter}>
        <button type="button" className={styles.clearFiltersButton} onClick={clearFilters}>Clear filters</button>
      </div>
    </section>

    {error && <div className={styles.error} role="alert"><strong>Could not load report</strong><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}

    <section className={styles.section} aria-labelledby="summary-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}>
        <div><span className={styles.sectionKicker}>SELECTED DATE RANGE</span><h2 id="summary-heading">Activity summary</h2><p>Verified activity totals for {selectedRangeLabel}.</p></div>
      </div>
      <div className={styles.kpiGrid}>
        {countFields.map(([field, label, totalKey], index) => <article className={`${styles.kpiCard} ${styles[`kpiTone${index}`]}`} key={field}>
          <span>{label}</span><strong>{number(totals[totalKey])}</strong><small>{loading ? "Refreshing…" : "In selected range"}</small>
        </article>)}
      </div>
    </section>

    <section className={styles.section} aria-labelledby="breakdown-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}>
        <div><span className={styles.sectionKicker}>DAILY ACTIVITY · ASIA/DHAKA</span><h2 id="breakdown-heading">Day activity breakdown</h2><p>Verified actions by day and team member for the selected range and filters.</p></div>
        <span className={styles.sectionCount}>{number(activityBreakdown.reduce((sum, row) => sum + countFields.reduce((subtotal, [field]) => subtotal + Number(row[field] || 0), 0), 0))} matching actions</span>
      </div>
      {activityBreakdown.length === 0 ? <div className={styles.emptyState}>{loading ? "Loading daily activity…" : "No activity recorded in this range for these filters."}</div> : <>
        <div className={styles.tableWrap}>
          <table className={styles.reportTable}>
            <thead><tr><th>Day</th><th>Team member</th>{countFields.map(([, label]) => <th key={label}>{label}</th>)}<th>Total actions</th></tr></thead>
            <tbody>{activityBreakdown.map((row) => <tr key={`${row.period}-${row.actor_user_id}`}>
              <td>{row.period ? fmtDhakaDay(row.period) : "—"}</td>
              <td><strong>{row.display_name || row.email || "Deleted member"}</strong>{row.email && <small>{row.email}</small>}</td>
              {countFields.map(([field]) => <td key={field} className={styles.numericCell}>{number(row[field])}</td>)}
              <td><span className={styles.totalPill}>{number(countFields.reduce((sum, [field]) => sum + Number(row[field] || 0), 0))}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.mobileBreakdown}>
          {activityBreakdown.map((row) => <article className={styles.mobileSummaryCard} key={`${row.period}-${row.actor_user_id}`}>
            <div className={styles.mobileSummaryHeader}><strong>{row.display_name || row.email || "Deleted member"}</strong><span>{number(countFields.reduce((sum, [field]) => sum + Number(row[field] || 0), 0))} total</span></div>
            {row.period && <p className={styles.memberEmail}>{fmtDhakaDay(row.period)}</p>}
            <div className={styles.mobileMetrics}>{countFields.map(([field, label]) => <div key={field}><span>{label}</span><strong>{number(row[field])}</strong></div>)}</div>
          </article>)}
        </div>
      </>}
    </section>

    <section className={styles.section} aria-labelledby="actions-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}>
        <div><span className={styles.sectionKicker}>AUDIT TRAIL</span><h2 id="actions-heading">Action details</h2><p>Newest verified events first. Opening a job link alone is not counted.</p></div>
        <span className={styles.sectionCount}>{number(pagination.total)} matching actions</span>
      </div>
      {events.length === 0 ? <div className={styles.emptyState}>{loading ? "Loading action records…" : "No action records match these filters."}</div> : <>
        <div className={styles.tableWrap}>
          <table className={`${styles.reportTable} ${styles.actionTable}`}>
            <thead><tr><th>When</th><th>Team member</th><th>Action</th><th>Job</th><th>Candidate / base resume</th></tr></thead>
            <tbody>{events.map((event) => <tr key={event.id}>
              <td className={styles.dateCell}>{fmtTime(event.occurred_at)}</td>
              <td><strong>{event.actor_name || event.actor_email || "Deleted member"}</strong>{event.actor_email && <small>{event.actor_email}</small>}</td>
              <td><span className={styles.actionBadge}>{eventNames[event.event_type] || event.event_type.replaceAll("_", " ")}</span></td>
              <td>{event.job_title ? <>{event.job_id ? <Link href={`/jobs/${event.job_id}`}>{event.job_title}</Link> : event.job_title}<small>{[event.job_company, event.job_location].filter(Boolean).join(" · ") || "Company/location not recorded"}</small></> : <span className={styles.dim}>—</span>}</td>
              <td>{event.candidate_name || <span className={styles.dim}>—</span>}{event.base_resume_name && <small>{event.base_resume_name}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.mobileActionList}>
          {events.map((event) => <article className={styles.mobileActionCard} key={event.id}>
            <div className={styles.mobileActionTop}><span className={styles.actionBadge}>{eventNames[event.event_type] || event.event_type.replaceAll("_", " ")}</span><time>{fmtTime(event.occurred_at)}</time></div>
            <strong>{event.job_title || event.candidate_name || "Activity event"}</strong>
            {event.job_title && <span className={styles.mobileSubline}>{[event.job_company, event.job_location].filter(Boolean).join(" · ")}</span>}
            <dl><div><dt>Team member</dt><dd>{event.actor_name || event.actor_email || "Deleted member"}</dd></div><div><dt>Candidate</dt><dd>{event.candidate_name || "—"}</dd></div>{event.base_resume_name && <div><dt>Base resume</dt><dd>{event.base_resume_name}</dd></div>}</dl>
            {event.job_id && <Link href={`/jobs/${event.job_id}`} className={styles.mobileJobLink}>Open job details ↗</Link>}
          </article>)}
        </div>
        <div className={styles.pagination}>
          <div className={styles.paginationMeta}>
            <span>Showing {number(pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1)}–{number(Math.min(pagination.page * pagination.pageSize, pagination.total))} of {number(pagination.total)}</span>
            <label>Rows per page <select className="input" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); setPageInput(""); setPageError(""); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
          </div>
          <div className={styles.paginationControls}>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</button>
            {(() => {
              const pages: Array<number | string> = [];
              const totalPages = pagination.totalPages;
              if (totalPages <= 7) {
                for (let current = 1; current <= totalPages; current++) pages.push(current);
              } else if (page <= 4) {
                pages.push(1, 2, 3, 4, 5, "…", totalPages);
              } else if (page >= totalPages - 3) {
                pages.push(1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
              } else {
                pages.push(1, "…", page - 1, page, page + 1, "…", totalPages);
              }
              return pages.map((entry, index) => (
                <button
                  key={`${entry}-${index}`}
                  type="button"
                  className={entry === page ? "btn-primary" : undefined}
                  onClick={() => typeof entry === "number" && entry !== page ? setPage(entry) : undefined}
                  disabled={loading || entry === "…"}
                  aria-current={entry === page ? "page" : undefined}
                  style={{ minWidth: 36, textAlign: "center", cursor: entry === "…" || entry === page ? "default" : "pointer", padding: "6px 12px", background: entry === "…" ? "transparent" : undefined, border: entry === "…" ? "none" : undefined, opacity: entry === "…" ? 0.7 : undefined }}
                >{entry}</button>
              ));
            })()}
            <button type="button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Next</button>
            <label className={styles.goToPageLabel}>Page</label>
            <input
              className="input"
              type="number"
              min={1}
              max={pagination.totalPages}
              value={pageInput}
              onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") goToPage(pageInput); }}
              placeholder={`1–${pagination.totalPages}`}
              aria-label="Page number"
            />
            <button type="button" onClick={() => goToPage(pageInput)} disabled={loading}>Go</button>
          </div>
          {pageError && <span className={styles.pageError} role="alert">{pageError}</span>}
        </div>
      </>}
      <p className={styles.auditNote}>Reviews count when a team member moves an application from Ready for Review to Ready for Application. Applications count when the stage moves to Applied.</p>
    </section>

    <section className={`${styles.section} ${styles.teamTotalsSection}`} aria-labelledby="team-totals-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}>
        <div><span className={styles.sectionKicker}>TEAM ROLLUP</span><h2 id="team-totals-heading">Team member totals</h2><p>One row per team member for the selected date range, including members with no matching actions.</p></div>
        <span className={styles.sectionCount}>{filteredMemberTotals.length} team members</span>
      </div>
      {filteredMemberTotals.length === 0 ? <div className={styles.emptyState}>{loading ? "Loading team totals…" : "No team members are available."}</div> : <>
        <div className={styles.tableWrap}>
          <table className={`${styles.reportTable} ${styles.memberTable}`}>
            <thead><tr><th>Team member</th>{countFields.map(([, label]) => <th key={label}>{label}</th>)}<th>Total actions</th></tr></thead>
            <tbody>{filteredMemberTotals.map((row) => <tr key={row.actor_user_id}>
              <td><strong>{row.display_name || row.email || "Deleted member"}</strong><small>{row.email || (row.actor_user_id === "deleted-member" ? "Historical activity retained" : "")}</small></td>
              {countFields.map(([field]) => <td key={field} className={styles.numericCell}>{number(row[field])}</td>)}
              <td><span className={styles.totalPill}>{number(countFields.reduce((sum, [field]) => sum + Number(row[field] || 0), 0))}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.mobileBreakdown}>
          {filteredMemberTotals.map((row) => <article className={styles.mobileSummaryCard} key={row.actor_user_id}>
            <div className={styles.mobileSummaryHeader}><strong>{row.display_name || row.email || "Deleted member"}</strong><span>{number(countFields.reduce((sum, [field]) => sum + Number(row[field] || 0), 0))} total</span></div>
            {row.email && <p className={styles.memberEmail}>{row.email}</p>}
            <div className={styles.mobileMetrics}>{countFields.map(([field, label]) => <div key={field}><span>{label}</span><strong>{number(row[field])}</strong></div>)}</div>
          </article>)}
        </div>
      </>}
    </section>
  </div>;
}
