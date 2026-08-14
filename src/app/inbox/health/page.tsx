"use client";
import { useEffect, useState } from "react";

export default function InboxHealthPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/inbox/health", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setData).catch(() => {}); }, []);
  if (!data) return <main className="page-shell"><p className="muted">Loading inbox health…</p></main>;
  const m = data.mail || {};
  return <main className="page-shell" style={{ maxWidth: 1100 }}>
    <p className="page-kicker">Communication intelligence</p><h1>Inbox health</h1>
    <p className="muted">Operational view of Gmail ingestion, triage coverage, suppression, and AE workload.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 20 }}>
      {[['Stored', m.total], ['Triaged', m.triaged], ['Untriaged', m.untriaged], ['Suppressed', m.suppressed], ['Relevant', m.relevant], ['Gmail accounts', data.sync?.active_accounts]].map(([label, value]) => <section className="card" key={String(label)}><small className="muted">{label}</small><h2 style={{ marginBottom: 0 }}>{value ?? 0}</h2></section>)}
    </div>
    <section className="card" style={{ marginTop: 20 }}><h2>Open AE workload</h2>{(data.tasks || []).map((x: any) => <div key={x.type} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "10px 0" }}><span>{String(x.type).replaceAll("_", " ")}</span><strong>{x.count}</strong></div>)}</section>
    <section className="card" style={{ marginTop: 20 }}><h2>Candidate sync health</h2>{(data.candidates || []).map((x: any) => <div key={x.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}><strong>{x.candidate_name}</strong><span className="badge" style={{ marginLeft: 8, color: x.health_state === "attention" ? "#b91c1c" : "#15803d" }}>{x.health_state === "attention" ? "Attention" : "Healthy"}</span><p className="muted" style={{ marginBottom: 0 }}>{x.message_count} messages · {x.untriaged_count} untriaged · last sync {x.last_synced_at ? new Date(x.last_synced_at).toLocaleString() : "never"}{x.sync_error ? ` · ${x.sync_error}` : ""}</p></div>)}</section>
    <section className="card" style={{ marginTop: 20 }}><h2>Human feedback</h2>{(data.feedback || []).map((x: any) => <div key={x.kind} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "10px 0" }}><span>{x.kind}</span><strong>{x.count}</strong></div>)}</section>
    <section className="card" style={{ marginTop: 20 }}><h2>Classification over last 30 days</h2>{(data.categories || []).map((x: any) => <div key={x.category} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "10px 0" }}><span>{String(x.category).replaceAll("_", " ")}</span><strong>{x.count}</strong></div>)}</section>
  </main>;
}
