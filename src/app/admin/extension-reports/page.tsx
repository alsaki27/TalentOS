"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TeamMember = { user_id: string; display_name: string | null; email: string; role: string; is_active: boolean };
type Aggregate = {
  actor_user_id: string; display_name: string | null; email: string; period: string;
  jobs_added: number; duplicate_captures: number; candidates_logged: number;
  resumes_edited: number; applications_reviewed: number; applications_applied: number;
};
type EventRow = {
  id: string; event_type: string; occurred_at: string; match_score: number | null;
  actor_name: string | null; actor_email: string; job_title: string | null; job_company: string | null;
  job_id: string | null; job_location: string | null; candidate_name: string | null; base_resume_name: string | null;
  application_id: string | null; metadata: Record<string, unknown> | null;
};

const countFields = [
  ["jobs_added", "Jobs added", "job_added"],
  ["duplicate_captures", "Duplicate captures", "job_duplicate"],
  ["candidates_logged", "Candidates logged", "candidate_logged"],
  ["resumes_edited", "Resume edits", "resume_edited"],
  ["applications_reviewed", "Reviews completed", "application_reviewed"],
  ["applications_applied", "Marked as applied", "application_applied"],
] as const satisfies ReadonlyArray<readonly [keyof Aggregate, string, string]>;
const eventNames: Record<string, string> = {
  job_added: "Job added", job_duplicate: "Duplicate capture", candidate_logged: "Candidate logged",
  resume_edited: "Tailored resume edited", application_reviewed: "Review stage completed",
  application_applied: "Application marked applied",
};
const fmtDate = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", dateStyle: "medium" }).format(new Date(value));
const fmtTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function ExtensionReportsPage() {
  const [role, setRole] = useState("");
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState("day");
  const [memberId, setMemberId] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [aggregates, setAggregates] = useState<Aggregate[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [eventsCapped, setEventsCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setError("");
    try {
      const boot = await fetch("/api/bootstrap", { cache: "no-store", signal: controller.signal });
      if (boot.ok) setRole((await boot.json())?.profile?.role ?? "");
      const params = new URLSearchParams({ days: String(days), group });
      if (memberId) params.set("memberId", memberId);
      const res = await fetch(`/api/admin/extension-reports?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load report.");
      if (controller.signal.aborted) return;
      setTeamMembers(body.teamMembers || []); setAggregates(body.aggregates || []);
      setEvents(body.events || []); setTotals(body.totals || {}); setEventsCapped(!!body.eventsCapped);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [days, group, memberId]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const memberTotals = useMemo(() => {
    const map = new Map<string, Aggregate>();
    const displayedMembers = memberId ? teamMembers.filter((member) => member.user_id === memberId) : teamMembers;
    for (const member of displayedMembers) {
      map.set(member.user_id, {
        actor_user_id: member.user_id,
        display_name: member.display_name,
        email: member.email,
        period: "",
        jobs_added: 0,
        duplicate_captures: 0,
        candidates_logged: 0,
        resumes_edited: 0,
        applications_reviewed: 0,
        applications_applied: 0,
      });
    }
    for (const row of aggregates) {
      const total = map.get(row.actor_user_id) || { ...row, period: "" };
      for (const [field] of countFields) total[field] = Number(total[field] || 0) + Number(row[field] || 0) as never;
      map.set(row.actor_user_id, total);
    }
    return Array.from(map.values()).sort((a, b) => a.display_name?.localeCompare(b.display_name || "") || a.email.localeCompare(b.email));
  }, [aggregates, teamMembers, memberId]);

  if (role && role !== "admin") return <p className="form-error" style={{ padding: 24 }}>This report is available to admins only.</p>;

  return <>
    <div className="page-header">
      <div><h1>Team Member Activity</h1><p className="muted" style={{ marginTop: 4 }}>Verified job, candidate, resume, review, and application actions for the full team. Opening a job link is not counted.</p></div>
      <Link href="/admin/extension-keys" className="btn" style={{ marginLeft: "auto" }}>Manage team keys</Link>
    </div>

    <div className="card" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}>
      <label style={{ display: "grid", gap: 5, fontSize: 12 }}>Period in days
        <input className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} style={{ width: 120 }} />
      </label>
      <label style={{ display: "grid", gap: 5, fontSize: 12 }}>Group by
        <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select>
      </label>
      <label style={{ display: "grid", gap: 5, fontSize: 12 }}>Team member
        <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">All team members</option>{teamMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email} · {member.role.replaceAll("_", " ")}{member.is_active ? "" : " (inactive)"}</option>)}</select>
      </label>
      <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>Times shown in Asia/Dhaka</span>
    </div>

    {error && <p className="form-error">{error}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
      {countFields.map(([field, label, totalKey]) => <div className="card" key={field} aria-busy={loading} style={{ padding: 16 }}><div className="muted" style={{ fontSize: 12 }}>{label}</div><strong style={{ display: "block", fontSize: 26, marginTop: 6 }}>{Number(totals[totalKey] || 0)}</strong></div>)}
    </div>

    <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
      <h2 className="section-title">Team member totals</h2>
      {loading ? <p>Loading report…</p> : memberTotals.length === 0 ? <p className="muted">No team members are available.</p> : <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 13 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}><th style={{ padding: 8 }}>Team member</th>{countFields.map(([, label]) => <th key={label} style={{ padding: 8 }}>{label}</th>)}</tr></thead>
        <tbody>{memberTotals.map((row) => <tr key={row.actor_user_id} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 8 }}>{row.display_name || row.email}<div className="muted" style={{ fontSize: 11 }}>{row.email}</div></td>{countFields.map(([field]) => <td key={field} style={{ padding: 8 }}>{Number(row[field] || 0)}</td>)}</tr>)}</tbody>
      </table>}
    </div>

    <div className="card" style={{ overflowX: "auto" }}>
      <h2 className="section-title">{group[0].toUpperCase() + group.slice(1)} activity breakdown</h2>
      {!loading && aggregates.length === 0 ? <p className="muted">No activity recorded for this period.</p> : <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 850, fontSize: 12 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}><th style={{ padding: 8 }}>Period</th><th style={{ padding: 8 }}>Team member</th>{countFields.map(([, label]) => <th key={label} style={{ padding: 8 }}>{label}</th>)}</tr></thead>
        <tbody>{aggregates.map((row, i) => <tr key={`${row.actor_user_id}-${row.period}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 8 }}>{fmtDate(row.period)}</td><td style={{ padding: 8 }}>{row.display_name || row.email}</td>{countFields.map(([field]) => <td key={field} style={{ padding: 8 }}>{Number(row[field] || 0)}</td>)}</tr>)}</tbody>
      </table>}
    </div>

    <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
      <h2 className="section-title">Action details</h2>
      {eventsCapped && <p className="muted" style={{ fontSize: 12 }}>Showing the newest 500 actions. Narrow the team member or date filter to see more detail.</p>}
      {!loading && events.length === 0 ? <p className="muted">No action records for this period.</p> : <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000, fontSize: 12 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}><th style={{ padding: 8 }}>When</th><th style={{ padding: 8 }}>Team member</th><th style={{ padding: 8 }}>Action</th><th style={{ padding: 8 }}>Job</th><th style={{ padding: 8 }}>Candidate / base resume</th><th style={{ padding: 8 }}>Fit</th></tr></thead>
        <tbody>{events.map((event) => <tr key={event.id} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 8, whiteSpace: "nowrap" }}>{fmtTime(event.occurred_at)}</td><td style={{ padding: 8 }}>{event.actor_name || event.actor_email}</td><td style={{ padding: 8 }}>{eventNames[event.event_type] || event.event_type}</td><td style={{ padding: 8 }}>{event.job_title ? <>{event.job_id ? <Link href={`/jobs/${event.job_id}`}>{event.job_title}</Link> : event.job_title}<div className="muted">{event.job_company} · {event.job_location}</div></> : "—"}</td><td style={{ padding: 8 }}>{event.candidate_name || "—"}{event.base_resume_name && <div className="muted">{event.base_resume_name}</div>}</td><td style={{ padding: 8 }}>{event.match_score == null ? "—" : `${event.match_score}/100`}</td></tr>)}</tbody>
      </table>}
      <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Reviews count only when a team member changes an application from Ready for Review to Ready for Application. Applications count when the stage is moved to Applied. Resume edits are listed separately.</p>
    </div>
  </>;
}
