"use client";

import { useEffect, useState } from "react";
import { openFaloodStudio } from "@/lib/falood/openStudio";
import { classifyWorkflowFailure } from "@/lib/ai/application-agents/workflowFailureClassifier";

export default function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const [app, setApp] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [a, e, c, x, m] = await Promise.all([
        fetch(`/api/applications/${params.id}`, { cache: "no-store" }),
        fetch(`/api/applications/${params.id}/events`, { cache: "no-store" }),
        fetch(`/api/applications/${params.id}/comments`, { cache: "no-store" }),
        fetch(`/api/applications/${params.id}/resume-exports`, { cache: "no-store" }),
        fetch(`/api/applications/${params.id}/emails`, { cache: "no-store" }),
      ]);
      if (!a.ok) throw new Error("Application could not be loaded");
      setApp(await a.json()); setEvents(e.ok ? await e.json() : []); setComments(c.ok ? await c.json() : []);
      const exportData = x.ok ? await x.json() : {}; setExports(exportData.exports || []); setEmails(m.ok ? await m.json() : []);
    } catch (e: any) { setError(e.message || "Could not load application"); }
  }
  useEffect(() => { void load(); }, [params.id]);
  async function addNote() {
    if (!note.trim()) return;
    const res = await fetch(`/api/applications/${params.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: note.trim(), visibleToCandidate: false }) });
    if (!res.ok) { setError("Could not save note"); return; }
    setNote(""); await load();
  }
  if (!app) return <main className="page-shell"><p className={error ? "error" : "muted"}>{error || "Loading application…"}</p></main>;
  const job = app.job || {}; const candidate = app.candidate || {}; const stage = app.application_stage || app.ae_stage || app.status || "unknown";
  return <main className="page-shell" style={{ maxWidth: 1200 }}>
    <p className="page-kicker">Application record</p><div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><div><h1>{job.title || "Application"}</h1><p className="muted">{job.company || "Unknown company"} · {candidate.name || "Candidate"}</p><code>{params.id}</code></div><span className="badge" style={{ padding: "8px 14px" }}>{stage.replaceAll("_", " ")}</span></div>
    <section className="card" style={{ marginTop: 24 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}><Info label="Applied" value={app.applied_at ? new Date(app.applied_at).toLocaleString() : "Not recorded"} /><Info label="Owner" value={app.assigned_to || "Unassigned"} /><Info label="Tailored resume" value={app.tailored_resume_version_id ? app.tailored_resume_version_id.slice(0, 12) : "Not linked"} /><Info label="Application ID" value={params.id} /></div>{app.tailored_resume_version_id && <button className="btn-primary btn-sm" style={{ display: "inline-block", marginTop: 18 }} onClick={() => openFaloodStudio("application_resume_version", app.tailored_resume_version_id)}>Open tailored resume</button>}
      {!app.tailored_resume_version_id && app.resume_generation_error && (() => {
        const classification = classifyWorkflowFailure(app.resume_generation_error);
        return <div style={{ marginTop: 18, padding: 12, borderRadius: 6, background: "rgba(211, 38, 30, 0.1)", color: "var(--danger)" }}>
          <strong>Resume generation failed:</strong> {classification?.reason ?? app.resume_generation_error}
          {classification && classification.category !== "other" && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{app.resume_generation_error}</div>}
        </div>;
      })()}
    </section>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, marginTop: 20 }}><section className="card"><h2>Interview & AE notes</h2><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Recruiter call, interview date, interviewer, outcome, next action…" rows={4} style={{ width: "100%", boxSizing: "border-box" }} /><button className="btn-primary btn-sm" onClick={addNote} disabled={!note.trim()}>Add private note</button>{comments.length ? comments.map(c => <article key={c.id} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}><strong>{c.commenter_name || "Team member"}</strong><p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p><small className="muted">{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</small></article>) : <p className="muted">No notes yet.</p>}</section><section className="card"><h2>Resume archive</h2>{exports.length ? exports.map(x => <div key={x.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}><strong>{x.file_name}</strong><p className="muted">{x.status} · {x.created_at ? new Date(x.created_at).toLocaleString() : ""}</p>{x.storage_url && <a className="btn-sm" href={x.storage_url} target="_blank" rel="noreferrer">Open SharePoint</a>} </div>) : <p className="muted">No archived export for this application.</p>}</section></div>
    <section className="card" style={{ marginTop: 20 }}><h2>Email log ({emails.length})</h2>{emails.length ? emails.map(mail => <article key={mail.id} style={{ borderTop: "1px solid var(--border)", padding: "14px 0" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{mail.subject || "(no subject)"}</strong><small className="muted">{mail.sent_at ? new Date(mail.sent_at).toLocaleString() : ""}</small></div><p className="muted" style={{ margin: "6px 0" }}>{mail.direction === "outbound" ? "Sent" : "Received"} · {mail.from_email || "Unknown sender"} · {mail.match_method} match</p><p style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", marginBottom: 0 }}>{mail.body_text || mail.snippet || "No body available."}</p></article>) : <p className="muted">No linked emails yet. Matching will appear here as Gmail messages are triaged.</p>}</section>
    <section className="card" style={{ marginTop: 20 }}><h2>Stage history</h2>{events.length ? events.map(e => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "10px 0" }}><span>{e.from_stage || e.from_status || "Created"} → {e.to_stage || e.to_status}</span><small className="muted">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</small></div>) : <p className="muted">No stage events recorded.</p>}</section>
  </main>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><small className="muted">{label}</small><div style={{ marginTop: 5, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</div></div>; }
