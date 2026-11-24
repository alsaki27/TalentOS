"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Activity, ArrowLeft, ArrowUpRight, BookOpen, CalendarClock, Clock3, ExternalLink, GraduationCap, ShieldCheck, NotebookPen, Plus, Pencil, Trash2 } from "lucide-react";
import { activityDateLabel, activityScheduleLabel, CANDIDATE_ACTIVITY_TYPES, CANDIDATE_CARD_UPCOMING_LIMIT, CANDIDATE_ACTIVITY_REFRESH_MS, safeActivityUrl, type CandidateActivityData, type CandidateActivityItem, type CandidateActivityType } from "@/lib/candidateActivity";
import type { CandidateCustomActivity } from "@/lib/candidateCustomActivity";
import { CandidateCustomActivityEditor } from "./CandidateCustomActivityEditor";
import { CandidateSectionPagination } from "./CandidateSectionPagination";
import styles from "./CandidateActivity.module.css";

const icons = { interview: CalendarClock, mock: GraduationCap, training: BookOpen, opt: ShieldCheck, status: Activity, follow_up: Clock3, custom: NotebookPen };
const typeNames = { interview: "Interviews", mock: "Mock interviews", training: "Training", opt: "OPT", status: "Status changes", follow_up: "Follow-ups", custom: "Custom activities" };

function LinkedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => {
    const link = /^https?:\/\//.test(part) ? safeActivityUrl(part) : null;
    return link ? <a key={index} href={link} target="_blank" rel="noopener noreferrer">{part}</a> : part;
  })}</>;
}

function DetailFields({ fields }: { fields: CandidateActivityItem["details"] }) {
  return <dl>{fields.map(({ label, value }, index) => <div key={`${label}-${index}`} className={value.length > 160 || value.includes("\n") ? styles.longDetail : undefined}>
    <dt>{label}</dt><dd><LinkedText text={value} /></dd>
  </div>)}</dl>;
}

function conciseDetails(fields: CandidateActivityItem["details"], item: CandidateActivityItem, previous: CandidateActivityItem["details"] = []) {
  const visible = fields.filter(field => {
    if (field.label === "Status" && field.value.replace(/_/g, " ").toLowerCase() === item.status?.replace(/_/g, " ").toLowerCase()) return false;
    if (field.label === "Time zone" && fields.some(value => value.label === "Appointment")) return false;
    if (field.label === "Stage name" && field.value.toLowerCase() === "interview") return false;
    return !previous.some(value => value.label === field.label && value.value === field.value);
  });
  const format = visible.find(field => field.label === "Format"), duration = visible.find(field => field.label === "Duration");
  return format && duration ? visible.filter(field => field !== duration).map(field => field === format ? { label: "Format / duration", value: `${format.value} · ${duration.value}` } : field) : visible;
}

function ItemDetails({ item }: { item: CandidateActivityItem }) {
  const recorded = conciseDetails(item.details, item);
  const current = conciseDetails(item.currentDetails || [], item, recorded);
  return <div className={styles.detailBody}>
    {recorded.length > 0 && <div className={styles.detailGroup}>
      {!!current.length && <h4>Recorded change</h4>}
      <DetailFields fields={recorded} />
    </div>}
    {!!current.length && <div className={styles.detailGroup}>
      <h4>{item.currentDetailsTitle || "Current interview details"}</h4>
      <DetailFields fields={current} />
    </div>}
    <div className={styles.links}>{item.links.map((link, index) => {
      const href = safeActivityUrl(link.href);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link.label}<ExternalLink size={12} aria-hidden="true" /></a> : null;
    })}</div>
  </div>;
}

function ActivityRow({ item, upcoming = false, detailed = false, onCustomAction }: { item: CandidateActivityItem; upcoming?: boolean; detailed?: boolean; onCustomAction?: (activity: CandidateCustomActivity, deleting?: boolean) => void }) {
  const Icon = icons[item.type];
  return <li className={styles.row} data-kind={item.type}>
    <span className={styles.icon} aria-hidden="true"><Icon size={16} /></span>
    <div className={styles.rowBody}>
      <div className={styles.rowHeading}><h3>{item.title}</h3>
        {item.status && <span className={styles.badge} data-state={item.status}>{item.status.replace(/_/g, " ")}</span>}
        <time dateTime={item.at}>{upcoming ? activityScheduleLabel(item) : activityDateLabel(item.at, item.dateOnly, item.timeZone)}</time>
      </div>
      {item.summary && <p className={styles.summary}>{item.summary}</p>}
      {item.customActivity && onCustomAction && <div className={styles.customActions}>
        <button type="button" onClick={() => onCustomAction(item.customActivity!)}><Pencil size={13} aria-hidden="true" />Edit</button>
        <button type="button" onClick={() => onCustomAction(item.customActivity!, true)}><Trash2 size={13} aria-hidden="true" />Delete</button>
      </div>}
      <details className={styles.details}>
        <summary>{upcoming ? "Show details" : "Show more"}</summary>
        <div className={detailed ? styles.fullDetails : undefined}><ItemDetails item={item} /></div>
      </details>
    </div>
  </li>;
}

export function CandidateUpcomingPreview({ items, candidateId }: { items: CandidateActivityItem[] | null | undefined; candidateId: string }) {
  return <section className={styles.cardPreview} aria-label="Upcoming candidate activities">
    <div className={styles.previewHeading}><span><CalendarClock size={13} aria-hidden="true" />Next up</span>
      <a href={`/candidates/${candidateId}/activity`} target="_blank" rel="noopener noreferrer" aria-label="View all candidate activity"><ArrowUpRight size={14} /></a>
    </div>
    {items == null ? <p className={styles.empty}>Upcoming activity unavailable.</p> : items.length === 0 ?
      <p className={styles.empty}>No upcoming activities recorded.</p> : <ul className={styles.previewList}>
        {items.slice(0, CANDIDATE_CARD_UPCOMING_LIMIT).map((item) => {
          const Icon = icons[item.type];
          const href = safeActivityUrl(item.links[0]?.href) || `/candidates/${candidateId}/activity`;
          return <li key={item.id} data-kind={item.type}>
            <span className={styles.smallIcon}><Icon size={13} aria-hidden="true" /></span>
            <div><a href={href} target="_blank" rel="noopener noreferrer">{item.title}</a>
              {item.summary && <p className={styles.previewContext}>{item.summary}</p>}
              <time dateTime={item.at}>{activityScheduleLabel(item)}</time>
            </div>
          </li>;
        })}
      </ul>}
  </section>;
}

export function CandidateActivity({ candidateId, full = false }: { candidateId: string; full?: boolean }) {
  const [data, setData] = useState<CandidateActivityData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [type, setType] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [page, setPage] = useState(1);
  const [customEditor, setCustomEditor] = useState<{ activity?: CandidateCustomActivity; deleting?: boolean } | null>(null);
  const [upcomingCount, setUpcomingCount] = useState(3);
  const [attempt, setAttempt] = useState(0);
  const expandedHistory = useRef(false);
  const requestVersion = useRef(0);
  const quietRefreshRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    expandedHistory.current = false;
    setLoading(true); setLoadingMore(false); setUpcomingCount(3); setError(""); setData(null);
    const params = new URLSearchParams({ limit: full ? "20" : "7" });
    if (full) params.set("page", String(page));
    if (type) params.set("type", type);
    if (dateStart) params.set("dateStart", dateStart);
    if (dateEnd) params.set("dateEnd", dateEnd);
    void fetch(`/api/candidates/${candidateId}/activity?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load candidate activity."); return body; })
      .then((body) => { if (!controller.signal.aborted && version === requestVersion.current) setData(body); })
      .catch((cause) => { if (!controller.signal.aborted && version === requestVersion.current) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted && version === requestVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [candidateId, full, type, dateStart, dateEnd, attempt, page]);

  useEffect(() => { if (full && data && page > Math.max(1, Math.ceil(data.total / 20))) setPage(Math.max(1, Math.ceil(data.total / 20))); }, [data, full, page]);

  // Refresh the compact first page quietly; expanded history is preserved until an explicit refresh.
  const refresh = useCallback(async () => {
    if (expandedHistory.current || document.visibilityState !== "visible") return;
    const version = requestVersion.current;
    const quietVersion = ++quietRefreshRequest.current;
    const params = new URLSearchParams({ limit: full ? "20" : "7" });
    if (full) params.set("page", String(page));
    if (type) params.set("type", type);
    if (dateStart) params.set("dateStart", dateStart);
    if (dateEnd) params.set("dateEnd", dateEnd);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/activity?${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      if (version === requestVersion.current && quietVersion === quietRefreshRequest.current && !expandedHistory.current) setData(body);
    } catch { /* Keep the last successful view. Explicit refresh surfaces errors. */ }
  }, [candidateId, full, type, dateStart, dateEnd, page]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, CANDIDATE_ACTIVITY_REFRESH_MS);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("candidate-activity") : null;
    if (channel) channel.onmessage = event => { if (event.data?.candidateId === candidateId) void refresh(); };
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); channel?.close(); window.removeEventListener("focus", focus); requestVersion.current += 1; };
  }, [refresh, candidateId]);

  async function loadMore() {
    if (!data?.nextCursor || loadingMore) return;
    const version = requestVersion.current;
    expandedHistory.current = true;
    setLoadingMore(true); setError("");
    const params = new URLSearchParams({ limit: full ? "25" : "7", cursor: data.nextCursor });
    if (type) params.set("type", type);
    if (dateStart) params.set("dateStart", dateStart);
    if (dateEnd) params.set("dateEnd", dateEnd);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/activity?${params}`, { cache: "no-store" });
      const body: CandidateActivityData & { error?: string } = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load more activity.");
      if (version === requestVersion.current) setData((current) => current ? {
        ...body, items: [...new Map([...current.items, ...body.items].map((item) => [item.id, item])).values()],
      } : body);
    } catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : "Could not load more activity."); }
    finally { if (version === requestVersion.current) setLoadingMore(false); }
  }

  return <section className={`${styles.activity}${full ? ` ${styles.fullActivity} candidate-activity-page` : ""}`} aria-label="Candidate activity" aria-busy={loading}>
    {full && <header className={styles.fullHeader}>
      <Link href={`/candidates/${candidateId}`}><ArrowLeft size={15} aria-hidden="true" />Back to applications</Link>
      <h1>{data?.candidate.name ? `${data.candidate.name} · Activity` : "Candidate activity"}</h1>
      <p>Interview milestones, mock feedback, training notes, and OPT updates.</p>
    </header>}
    <div className={styles.layout}>
      <section className={styles.timelineCard} aria-label="Recent candidate activity">
        <header className={styles.header}><div><h2><Activity size={17} aria-hidden="true" />{full ? "Activity history" : "Candidate activity"}</h2>
          <p>{full ? "Recorded activity, newest first." : "Recent milestones, newest first."}</p></div>
          <div className={styles.headerActions}>
            {data?.canManageCustom && <button type="button" className="btn-primary" onClick={() => setCustomEditor({})}><Plus size={14} aria-hidden="true" />Add activity</button>}
            <button type="button" disabled={loading || loadingMore} onClick={() => setAttempt((value) => value + 1)}>Refresh</button>
          </div>
        </header>
        {full && <>
          <div className={styles.filters} role="group" aria-label="Activity filters">
            <label className={styles.filter}>Activity type<select aria-label="Activity type" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">All activity</option>{CANDIDATE_ACTIVITY_TYPES.filter((kind) => kind !== "follow_up").map((kind) => <option key={kind} value={kind}>{typeNames[kind]}</option>)}
            </select></label>
            <div className={styles.dateFilter} role="group" aria-label="Timeline dates"><span>Timeline dates</span>
              <DateRangePicker dateStart={dateStart} dateEnd={dateEnd} onChange={(start, end) => { setDateStart(start); setDateEnd(end); setPage(1); }} />
            </div>
            {(type || dateStart || dateEnd) && <button type="button" onClick={() => { setType(""); setDateStart(""); setDateEnd(""); setPage(1); }}>Clear filters</button>}
          </div>
          <p className={styles.filterHint}>Filter by the dates shown in the timeline. Start and end dates are included.</p>
        </>}
        {error && <div className={styles.error} role="alert">{error} <button type="button" onClick={() => data?.nextCursor ? void loadMore() : setAttempt((value) => value + 1)}>Retry</button></div>}
        {loading && <p className={styles.empty} role="status">Loading candidate activity…</p>}
        {!loading && data?.warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
        {!loading && !data?.items.length && !error && <p className={styles.empty}>{data?.warnings.length ? "Activity could not be fully loaded from its sources." : type || dateStart || dateEnd ? "No recorded activity matches these filters." : "No recorded activity yet."}</p>}
        {!!data?.items.length && <ol className={styles.timeline}>{data.items.map((item) => <ActivityRow key={item.id} item={item} detailed={full}
          onCustomAction={data.canManageCustom ? (activity, deleting) => setCustomEditor({ activity, deleting }) : undefined} />)}</ol>}
        {data && full && <CandidateSectionPagination label="Activities" page={page} pageSize={20} total={data.total} onPageChange={setPage} pageSizeOptions={[20]} onPageSizeChange={() => setPage(1)} />}
        {data && !full && <footer className={styles.footer}><span>{data.items.length} of {data.total} recorded activities</span>
          <div className={styles.footerActions}>
            {data.nextCursor && <button type="button" disabled={loadingMore || loading} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Show 7 more"}</button>}
            <a className={styles.allActivityButton} href={`/candidates/${candidateId}/activity`} target="_blank" rel="noopener noreferrer"><Activity size={15} aria-hidden="true" />Show All Activity<ArrowUpRight size={14} aria-hidden="true" /></a>
          </div>
        </footer>}
      </section>
      <aside className={styles.sidebar} aria-label="Upcoming activities and current status">
        <section className={styles.upcomingCard}><header className={styles.header}><h2><CalendarClock size={17} aria-hidden="true" />Upcoming</h2></header>
          {!loading && !data?.upcoming.length && <p className={styles.empty}>{data?.warnings.some((warning) => warning.startsWith("Upcoming")) || error ? "Upcoming activity unavailable." : "No upcoming activities recorded."}</p>}
          {!!data?.upcoming.length && <ul className={styles.upcomingList}>{data.upcoming.slice(0, upcomingCount).map((item) => <ActivityRow key={item.id} item={item} upcoming />)}</ul>}
          {data && data.upcoming.length > upcomingCount && <button type="button" className={styles.moreUpcoming} onClick={() => setUpcomingCount((count) => count + 3)}>Show more upcoming</button>}
        </section>
        {!!data?.current.length && <section className={styles.currentCard}><h2>Current status</h2><dl>{data.current.map((item) =>
          <div key={item.label}><dt>{item.label}</dt><dd><a href={item.href} target="_blank" rel="noopener noreferrer">{item.value}<ArrowUpRight size={12} aria-hidden="true" /></a></dd></div>)}</dl></section>}
      </aside>
    </div>
    {customEditor && <CandidateCustomActivityEditor candidateId={candidateId} activity={customEditor.activity} deleting={customEditor.deleting} timeZone={data?.candidate.timezone}
      onClose={() => setCustomEditor(null)} onSaved={() => { setCustomEditor(null); setType(""); setPage(1); setAttempt(value => value + 1); }} />}
  </section>;
}
