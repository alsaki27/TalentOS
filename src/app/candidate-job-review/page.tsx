"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, CheckCircle2, XCircle, Inbox, AlertCircle, RotateCw, ChevronDown, ChevronUp } from "lucide-react";

interface AlternateResume { resumeId: string; resumeName: string | null; score: number }
interface ReviewItem {
  id: string;
  source: "scheduled_logging" | "extension";
  candidate_id: string; candidate_name: string;
  job_id: string; job_title: string; company: string | null; apply_url: string | null;
  base_resume_id: string | null; base_resume_name: string | null;
  alternate_resumes: AlternateResume[];
  ats_score: number | null;
  ai_status: "pending" | "scored" | "failed";
  ai_tier: "strong" | "adjacent" | "stretch" | null;
  ai_score: number | null; ai_reason: string | null; ai_failure_reason: string | null;
  hard_gates: string[];
  status: "pending" | "approved" | "rejected";
  priority: "high" | "default" | "low";
  assigned_to_name: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
  application_id: string | null;
  created_at: string;
}

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

const TIER_LABEL: Record<string, string> = { strong: "Strong", adjacent: "Adjacent", stretch: "Stretch" };
const TIER_BADGE_CLASS: Record<string, string> = { strong: "badge-tier-a", adjacent: "badge-warn", stretch: "badge-accent" };
const SOURCE_LABEL: Record<string, string> = { scheduled_logging: "Scheduled logging", extension: "Extension" };

function formatDate(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function CandidateJobReviewPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]["value"]>("pending");
  const [sourceFilter, setSourceFilter] = useState<"all" | "scheduled_logging" | "extension">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "strong" | "adjacent" | "stretch" | "unscored">("all");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/admin/candidate-job-review?status=${status}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not load the review queue.");
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
    try {
      const note = action === "reject" ? window.prompt("Optional rejection reason") ?? "" : undefined;
      const response = await fetch(`/api/admin/candidate-job-review/${id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not ${action} this item.`);
      setNotice(action === "approve" ? "Approved — a real application was created and the AI resume workflow has started." : "Rejected.");
      await load();
    } catch (err: any) {
      setError(err.message || `Could not ${action} this item.`);
    }
    setBusy(null);
  }

  async function retryAi(id: string) {
    setBusy(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/candidate-job-review/${id}/retry-ai`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI eligibility check failed again.");
      setNotice("AI eligibility check succeeded.");
      await load();
    } catch (err: any) {
      setError(err.message || "AI eligibility check failed again.");
    }
    setBusy(null);
  }

  async function bulkApprove(tiers: string[]) {
    setBulkBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/candidate-job-review/bulk-approve", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tiers }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bulk approve failed.");
      setNotice(`Approved ${data.approved} item(s).${data.failed?.length ? ` ${data.failed.length} failed.` : ""}`);
      await load();
    } catch (err: any) {
      setError(err.message || "Bulk approve failed.");
    }
    setBulkBusy(false);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const visibleItems = items.filter((item) => {
    if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
    if (tierFilter === "unscored") return item.ai_status !== "scored";
    if (tierFilter !== "all" && item.ai_tier !== tierFilter) return false;
    return true;
  });
  const totalCount = counts.pending + counts.approved + counts.rejected;
  const pendingByTier = { strong: 0, adjacent: 0, stretch: 0 };
  for (const item of items) if (item.status === "pending" && item.ai_tier) (pendingByTier as any)[item.ai_tier]++;

  return <div className="page">
    <div className="page-header">
      <div>
        <h1>Review Queue</h1>
        <p className="page-kicker">Scheduled-logging matches and extension-captured candidates wait here for admin/manager approval before a real application is created and the AI resume workflow starts.</p>
      </div>
    </div>

    <div className="stats-strip" style={{ gridTemplateColumns: "repeat(4, minmax(140px, 1fr))" }}>
      {TABS.map((tab) =>
        <button key={tab.value} className={`stat-button ${status === tab.value ? "active" : ""}`} onClick={() => setStatus(tab.value)}>
          <span className="stat-label">{tab.label}</span>
          <span className="stat-value">{tab.value === "all" ? totalCount : counts[tab.value]}</span>
        </button>)}
    </div>

    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "14px 0" }}>
      <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)} style={{ width: "auto" }}>
        <option value="all">All sources</option>
        <option value="scheduled_logging">Scheduled logging</option>
        <option value="extension">Extension</option>
      </select>
      <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as any)} style={{ width: "auto" }}>
        <option value="all">All tiers</option>
        <option value="strong">Strong</option>
        <option value="adjacent">Adjacent</option>
        <option value="stretch">Stretch</option>
        <option value="unscored">AI unavailable (ATS only)</option>
      </select>
      {status === "pending" && <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Bulk approve:</span>
        <button className="btn-secondary" disabled={bulkBusy || !pendingByTier.strong} onClick={() => void bulkApprove(["strong"])}>
          Strong{pendingByTier.strong ? ` (${pendingByTier.strong})` : ""}
        </button>
        <button className="btn-secondary" disabled={bulkBusy || (pendingByTier.strong + pendingByTier.adjacent) === 0} onClick={() => void bulkApprove(["strong", "adjacent"])}>
          Strong + Adjacent{(pendingByTier.strong + pendingByTier.adjacent) ? ` (${pendingByTier.strong + pendingByTier.adjacent})` : ""}
        </button>
      </div>}
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
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Loading the review queue…</p>
        </div>
      : visibleItems.length === 0
        ? <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <Inbox size={28} className="muted" style={{ margin: "0 auto 12px auto" }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Nothing in this view</p>
            <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 13.5 }}>
              {status === "pending" ? "Nothing is waiting on review right now." : "Nothing to show for this filter yet."}
            </p>
          </div>
        : <div style={{ display: "grid", gap: 14 }}>
            {visibleItems.map((item) => {
              const isExpanded = expanded.has(item.id);
              const alternates = (item.alternate_resumes || []).filter((r) => r.resumeId !== item.base_resume_id);
              return <section className="card" key={item.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {item.candidate_name} <span className="muted" style={{ fontWeight: 500 }}>→</span> {item.job_title}
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      <span>{item.company || "Unknown company"}</span>
                      <span aria-hidden="true">·</span>
                      <span className="badge">{SOURCE_LABEL[item.source]}</span>
                      <span aria-hidden="true">·</span>
                      <span>Queued {formatDate(item.created_at)}</span>
                      {item.assigned_to_name && <><span aria-hidden="true">·</span><span>Owner: {item.assigned_to_name}</span></>}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                      Resume: {item.base_resume_name || "Unavailable"}
                      {alternates.length > 0 && <button style={{ marginLeft: 8, fontSize: 12, background: "none", border: 0, color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 2, padding: 0 }} onClick={() => toggleExpanded(item.id)}>
                        {alternates.length} other resume{alternates.length === 1 ? "" : "s"} scored {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>}
                    </div>
                    {isExpanded && alternates.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }} className="muted">
                      {alternates.map((alt) => <li key={alt.resumeId}>{alt.resumeName || "Untitled resume"} — {alt.score}/100</li>)}
                    </ul>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                    <span className="badge" style={{ fontSize: 12.5 }}>ATS {item.ats_score ?? "—"}</span>
                    {item.ai_status === "scored" && item.ai_tier && <span className={`badge ${TIER_BADGE_CLASS[item.ai_tier]}`} style={{ fontSize: 13, padding: "6px 12px" }}>
                      {TIER_LABEL[item.ai_tier]}{item.ai_score != null ? ` · ${item.ai_score}` : ""}
                    </span>}
                    {item.ai_status === "failed" && <span className="badge badge-warn" style={{ fontSize: 12.5 }} title={item.ai_failure_reason ?? undefined}>
                      AI check unavailable
                    </span>}
                    {item.ai_status === "pending" && <span className="badge muted" style={{ fontSize: 12.5 }}>AI not yet attempted</span>}
                  </div>
                </div>

                {item.ai_reason && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{item.ai_reason}</p>}
                {!item.ai_reason && item.ai_status === "failed" && <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  AI eligibility check could not complete: {item.ai_failure_reason || "unknown error"}. Showing the ATS score only — approve on that basis, or retry the AI check below.
                </p>}

                {item.hard_gates?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {item.hard_gates.map((gate, i) => <span key={i} className="badge badge-danger" style={{ fontSize: 12 }}>⚠ {gate}</span>)}
                </div>}

                {item.status === "rejected" && item.review_note && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  Rejected by {item.reviewed_by_name || "a reviewer"}{item.reviewed_at ? ` on ${formatDate(item.reviewed_at)}` : ""}: {item.review_note}
                </p>}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 12, marginTop: 2, borderTop: "1px solid var(--border)" }}>
                  {item.apply_url && <a className="btn-secondary" href={item.apply_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <ExternalLink size={14} /> Open job
                  </a>}
                  {item.application_id && <Link className="btn-primary" href="/application-queue">View application</Link>}
                  {item.status === "pending" && <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    {item.ai_status === "failed" && <button className="btn-secondary" disabled={busy === item.id} onClick={() => void retryAi(item.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Retry AI check
                    </button>}
                    <button className="btn-secondary" disabled={busy === item.id} onClick={() => void decide(item.id, "reject")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <XCircle size={14} /> Reject
                    </button>
                    <button className="btn-primary" disabled={busy === item.id} onClick={() => void decide(item.id, "approve")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve & start AI workflow
                    </button>
                  </div>}
                </div>
              </section>;
            })}
          </div>}
  </div>;
}
