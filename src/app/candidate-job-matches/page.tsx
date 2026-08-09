"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Decision {
  id: string; candidate_id: string; candidate_name: string; base_resume_name: string;
  job_title: string; company: string | null; location: string | null; source_url: string | null;
  posted_at: string | null; score: number; tier: "A" | "B"; reason: string;
  matched_terms: string[]; review_status: string; application_id: string | null;
}

export default function CandidateJobMatchesPage() {
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<Decision[]>([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/admin/candidate-job-matches?status=${status}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not load match decisions");
    else { setItems(data.items || []); setCounts(data.counts || { pending: 0, approved: 0, rejected: 0 }); }
    setLoading(false);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id); setError("");
    const note = action === "reject" ? window.prompt("Optional rejection reason") ?? "" : "Approved after AE review";
    const response = await fetch(`/api/admin/candidate-job-matches/${id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || `Could not ${action} recommendation`);
    else await load();
    setBusy(null);
  }

  return <main className="page-shell">
    <div className="page-header"><div>
      <h1>Candidate Match Review</h1>
      <p className="muted">Approved resume profiles matched to jobs posted in the last seven days. Nothing is submitted externally.</p>
    </div></div>
    <div className="card" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {(["pending", "approved", "rejected", "all"] as const).map((value) =>
        <button key={value} className={status === value ? "btn-primary" : "btn-secondary"} onClick={() => setStatus(value)}>
          {value[0].toUpperCase() + value.slice(1)}{value !== "all" ? ` (${counts[value]})` : ""}
        </button>)}
    </div>
    {error && <div className="card" style={{ borderColor: "#ef4444", marginBottom: 16 }}>{error}</div>}
    {loading ? <div className="card">Loading recommendations…</div> : items.length === 0 ? <div className="card">No recommendations in this view.</div> :
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((item) => <section className="card" key={item.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{item.candidate_name} → {item.job_title}</div>
              <div className="muted">{item.company || "Unknown company"} · {item.location || "Location not listed"} · Posted {item.posted_at || "unknown"}</div>
              <div className="muted">Resume: {item.base_resume_name}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, whiteSpace: "nowrap" }}>Tier {item.tier} · {item.score}</div>
          </div>
          <p>{item.reason}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(item.matched_terms || []).slice(0, 10).map((term) => <span key={term} style={{ padding: "4px 8px", borderRadius: 999, background: "var(--surface-2, #eef2ff)", fontSize: 12 }}>{term}</span>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {item.source_url && <a className="btn-secondary" href={item.source_url} target="_blank" rel="noreferrer">Open job</a>}
            <Link className="btn-secondary" href={`/candidates/${item.candidate_id}/job-search-profiles`}>Review profile</Link>
            {item.review_status === "pending" && <>
              <button className="btn-primary" disabled={busy === item.id} onClick={() => decide(item.id, "approve")}>Approve & start AI workflow</button>
              <button className="btn-secondary" disabled={busy === item.id} onClick={() => decide(item.id, "reject")}>Reject</button>
            </>}
            {item.application_id && <Link className="btn-primary" href="/application-queue">View application</Link>}
          </div>
        </section>)}
      </div>}
  </main>;
}
