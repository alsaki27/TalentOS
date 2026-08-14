"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Data = { upcoming: any[]; responses: any[]; history: any[]; signals: any[]; metrics: { urgentResponses: number; highResponses: number; interviewsNext48h: number; unlinkedSignals: number }; generatedAt: string };
const date = (v: string | null) => v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
const badgeColor = (value: string) => value === "urgent" ? "#b91c1c" : value === "high" ? "#b45309" : "#15803d";

export default function InboxCommandCenterPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/inbox/command-center", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error("Could not load command center."); return r.json(); }).then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <main className="page-shell"><p className="notice">{error}</p></main>;
  if (!data) return <main className="page-shell"><p className="muted">Loading recruiting command center…</p></main>;
  const waiting = data.responses.reduce((n, x) => n + Number(x.waiting_count || 0), 0);
  return <main className="page-shell" style={{ maxWidth: 1250 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div><p className="page-kicker">Communication intelligence</p><h1>Recruiting command center</h1><p className="muted">Email is the signal layer; scheduled interviews and AE work remain the operational record.</p></div>
      <div style={{ display: "flex", gap: 8 }}><Link className="btn" href="/inbox">Inbox</Link><Link className="btn" href="/interviews">Interview manager</Link><Link className="btn" href="/inbox/health">Sync health</Link></div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 20 }}>
      {[['Upcoming interviews', data.upcoming.length], ['Interviews in 48h', data.metrics.interviewsNext48h], ['Replies waiting', waiting], ['Urgent reply candidates', data.metrics.urgentResponses], ['Unlinked email signals', data.metrics.unlinkedSignals]].map(([label, value]) => <section className="card" key={String(label)}><small className="muted">{label}</small><h2 style={{ margin: "8px 0 0" }}>{value}</h2></section>)}
    </div>
    <section className="card" style={{ marginTop: 20 }}><h2>Upcoming interviews · next 30 days</h2>{data.upcoming.length === 0 ? <p className="muted">No scheduled interviews found.</p> : data.upcoming.map(x => <div key={x.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{x.candidate_name}</strong> · {x.round_name}<div className="muted">{x.job_title || "Job unavailable"}{x.company_name ? ` · ${x.company_name}` : ""} · {date(x.scheduled_at)}</div></div><div style={{ display: "flex", gap: 8 }}><Link className="btn" href={`/inbox?candidateId=${x.candidate_id}`}>Open emails</Link><span className="badge">{x.status || "scheduled"}</span></div></div>)}</section>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 16, marginTop: 16 }}>
      <section className="card"><h2>Replies waiting</h2>{data.responses.length === 0 ? <p className="muted">No unhandled inbound replies.</p> : data.responses.map(x => <div key={x.candidate_id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{x.candidate_name}</strong><span className="badge" style={{ color: badgeColor(x.priority) }}>{x.priority}</span></div><p className="muted" style={{ margin: "5px 0" }}>{x.waiting_count} waiting · oldest {date(x.oldest_waiting_at)} · {Math.round(Number(x.age_hours || 0))}h old</p><Link className="btn" href={`/inbox?candidateId=${x.candidate_id}`}>Work candidate inbox</Link></div>)}</section>
      <section className="card"><h2>Email signals needing review</h2>{data.signals.length === 0 ? <p className="muted">No interview, offer, rejection, or scheduling signals in the last 90 days.</p> : data.signals.slice(0, 12).map(x => <div key={x.email_id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}><strong>{x.candidate_name}</strong> · {x.ai_category?.replaceAll("_", " ")}<div className="muted">{x.subject || "(no subject)"} · {date(x.sent_at)}</div></div>)}</section>
    </div>
    <section className="card" style={{ marginTop: 16 }}><h2>Past interview history by candidate</h2>{data.history.length === 0 ? <p className="muted">No past interviews found.</p> : data.history.map(x => <div key={x.interview_id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0", display: "flex", justifyContent: "space-between", gap: 12 }}><div><strong>{x.candidate_name}</strong> · {x.round_name}<div className="muted">{x.job_title || "Job unavailable"}{x.company_name ? ` · ${x.company_name}` : ""} · {date(x.scheduled_at)}</div></div><span className="badge">{x.status || "completed"}</span></div>)}</section>
    <p className="muted" style={{ marginTop: 12 }}>Updated {date(data.generatedAt)}. Email signals are review cues; they do not silently change candidate stages without the existing approval policy.</p>
  </main>;
}
