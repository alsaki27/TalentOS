"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Inbox, AlertCircle } from "lucide-react";

interface Decision {
  id: string; candidate_id: string; candidate_name: string; base_resume_name: string;
  job_title: string; company: string | null; location: string | null; source_url: string | null;
  posted_at: string | null; score: number; tier: "A" | "B"; reason: string;
  matched_terms: string[]; review_status: string; application_id: string | null;
}

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

function formatPostedDate(value: string | null): string {
  if (!value) return "date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function CandidateJobMatchesPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]["value"]>("pending");
  const [items, setItems] = useState<Decision[]>([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [runningMatcher, setRunningMatcher] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/admin/candidate-job-matches?status=${status}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not load match decisions");
    else { setItems(data.items || []); setCounts(data.counts || { pending: 0, approved: 0, rejected: 0 }); }
    setLoading(false);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id); setError(""); setNotice("");
    const note = action === "reject" ? window.prompt("Optional rejection reason") ?? "" : "Approved after AE review";
    const response = await fetch(`/api/admin/candidate-job-matches/${id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || `Could not ${action} recommendation`);
    else { setNotice(action === "approve" ? "Match approved — the AI resume workflow has started." : "Recommendation rejected."); await load(); }
    setBusy(null);
  }

  async function forceRunMatcher() {
    setRunningMatcher(true);
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/candidate-job-matches/force-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to run matcher");
      await load();
      setNotice("Matcher run complete — recommendations refreshed.");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to trigger matcher");
    }
    setRunningMatcher(false);
  }

  const totalCount = counts.pending + counts.approved + counts.rejected;

  return <div className="page">
    <div className="page-header">
      <div>
        <h1>Candidate Match Review</h1>
        <p className="page-kicker">Approved resume profiles matched to jobs posted in the last seven days. Nothing is submitted externally.</p>
      </div>
      <button
        onClick={forceRunMatcher}
        disabled={runningMatcher}
        className="btn-primary"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
      >
        {runningMatcher ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        {runningMatcher ? "Running matcher…" : "Force run matcher"}
      </button>
    </div>

    <div className="stats-strip" style={{ gridTemplateColumns: "repeat(4, minmax(140px, 1fr))" }}>
      {TABS.map((tab) =>
        <button
          key={tab.value}
          className={`stat-button ${status === tab.value ? "active" : ""}`}
          onClick={() => setStatus(tab.value)}
        >
          <span className="stat-label">{tab.label}</span>
          <span className="stat-value">{tab.value === "all" ? totalCount : counts[tab.value]}</span>
        </button>)}
    </div>

    {error && <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16, fontSize: 13.5 }}>
      <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
    </div>}
    {notice && <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, borderColor: "var(--accent)", color: "var(--accent)", marginBottom: 16, fontSize: 13.5 }}>
      <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> {notice}
    </div>}

    {loading
      ? <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <Loader2 size={28} className="animate-spin muted" style={{ margin: "0 auto 12px auto" }} />
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Loading recommendations…</p>
        </div>
      : items.length === 0
        ? <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <Inbox size={28} className="muted" style={{ margin: "0 auto 12px auto" }} />
            <p style={{ margin: 0, fontWeight: 600 }}>No recommendations in this view</p>
            <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 13.5 }}>
              {status === "pending" ? "Run the matcher, or approve a candidate's resume search profile so it becomes eligible." : "Nothing to show for this filter yet."}
            </p>
          </div>
        : <div style={{ display: "grid", gap: 14 }}>
            {items.map((item) => <section className="card" key={item.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {item.candidate_name} <span className="muted" style={{ fontWeight: 500 }}>→</span> {item.job_title}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                    <span>{item.company || "Unknown company"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.location || "Location not listed"}</span>
                    <span aria-hidden="true">·</span>
                    <span>Posted {formatPostedDate(item.posted_at)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Resume: {item.base_resume_name}</div>
                </div>
                <span className={`badge ${item.tier === "A" ? "badge-tier-a" : "badge-tier-b"}`} style={{ fontSize: 13, padding: "6px 12px", flexShrink: 0 }}>
                  Tier {item.tier} · {item.score}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{item.reason}</p>

              {item.matched_terms?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {item.matched_terms.slice(0, 10).map((term) => <span key={term} className="badge">{term}</span>)}
                {item.matched_terms.length > 10 && <span className="muted" style={{ fontSize: 12 }}>+{item.matched_terms.length - 10} more</span>}
              </div>}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 12, marginTop: 2, borderTop: "1px solid var(--border)" }}>
                {item.source_url && <a className="btn-secondary" href={item.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ExternalLink size={14} /> Open job
                </a>}
                <Link className="btn-secondary" href={`/candidates/${item.candidate_id}/job-search-profiles`}>Review profile</Link>
                {item.application_id && <Link className="btn-primary" href="/application-queue">View application</Link>}
                {item.review_status === "pending" && <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <button className="btn-secondary" disabled={busy === item.id} onClick={() => decide(item.id, "reject")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <XCircle size={14} /> Reject
                  </button>
                  <button className="btn-primary" disabled={busy === item.id} onClick={() => decide(item.id, "approve")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve & start AI workflow
                  </button>
                </div>}
              </div>
            </section>)}
          </div>}
  </div>;
}
