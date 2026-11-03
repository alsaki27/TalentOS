"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, CheckCircle2, XCircle, Inbox, AlertCircle, AlertTriangle, RotateCw, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./review-queue.module.css";

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

  return <div className={`candidate-job-review-page ${styles.page}`}>
    <div className={`page-header ${styles.pageHeader}`}>
      <div>
        <h1>Review Queue</h1>
        <p className="page-kicker">Scheduled-logging matches and extension-captured candidates wait here for admin/manager approval before a real application is created and the AI resume workflow starts.</p>
      </div>
    </div>

    <div className={`stats-strip ${styles.stats}`}>
      {TABS.map((tab) =>
        <button key={tab.value} className={`stat-button ${status === tab.value ? "active" : ""}`} aria-pressed={status === tab.value} onClick={() => setStatus(tab.value)}>
          <span className="stat-label">{tab.label}</span>
          <span className="stat-value">{tab.value === "all" ? totalCount : counts[tab.value]}</span>
        </button>)}
    </div>

    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <select aria-label="Filter by source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)}>
          <option value="all">All sources</option>
          <option value="scheduled_logging">Scheduled logging</option>
          <option value="extension">Extension</option>
        </select>
        <select aria-label="Filter by AI tier" value={tierFilter} onChange={(e) => setTierFilter(e.target.value as any)}>
          <option value="all">All tiers</option>
          <option value="strong">Strong</option>
          <option value="adjacent">Adjacent</option>
          <option value="stretch">Stretch</option>
          <option value="unscored">AI unavailable (ATS only)</option>
        </select>
      </div>
      {status === "pending" && <div className={styles.bulkActions}>
        <span className={`muted ${styles.bulkLabel}`}>Bulk approve:</span>
        <button className="btn-secondary" disabled={bulkBusy || !pendingByTier.strong} onClick={() => void bulkApprove(["strong"])}>
          Strong{pendingByTier.strong ? ` (${pendingByTier.strong})` : ""}
        </button>
        <button className="btn-secondary" disabled={bulkBusy || (pendingByTier.strong + pendingByTier.adjacent) === 0} onClick={() => void bulkApprove(["strong", "adjacent"])}>
          Strong + Adjacent{(pendingByTier.strong + pendingByTier.adjacent) ? ` (${pendingByTier.strong + pendingByTier.adjacent})` : ""}
        </button>
      </div>}
    </div>

    {error && <div role="alert" className={`card ${styles.message} ${styles.error}`}>
      <AlertCircle size={16} /> <span>{error}</span>
    </div>}
    {notice && <div role="status" className={`card ${styles.message} ${styles.notice}`}>
      <CheckCircle2 size={16} /> <span>{notice}</span>
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
        : <div className={styles.cards}>
            {visibleItems.map((item) => {
              const isExpanded = expanded.has(item.id);
              const alternates = (item.alternate_resumes || []).filter((r) => r.resumeId !== item.base_resume_id);
              return <section className={`card ${styles.card}`} key={item.id} aria-labelledby={`review-title-${item.id}`}>
                <div className={styles.cardHeader}>
                  <div className={styles.identity}>
                    <h2 id={`review-title-${item.id}`} className={styles.title}>
                      {item.candidate_name} <span className="muted" style={{ fontWeight: 500 }}>→</span> {item.job_title}
                    </h2>
                    <div className={`muted ${styles.metadata}`}>
                      <span>{item.company || "Unknown company"}</span>
                      <span className="badge">{SOURCE_LABEL[item.source]}</span>
                      <span>Queued <time dateTime={item.created_at}>{formatDate(item.created_at)}</time></span>
                      {item.assigned_to_name && <span>Owner: {item.assigned_to_name}</span>}
                    </div>
                    <div className={`muted ${styles.resumeRow}`}>
                      <span>Resume: {item.base_resume_name || "Unavailable"}</span>
                      {alternates.length > 0 && <button className={styles.resumeToggle} aria-expanded={isExpanded} aria-controls={`review-resumes-${item.id}`} onClick={() => toggleExpanded(item.id)}>
                        {alternates.length} other resume{alternates.length === 1 ? "" : "s"} scored {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>}
                    </div>
                    {isExpanded && alternates.length > 0 && <ul id={`review-resumes-${item.id}`} className={`muted ${styles.alternates}`}>
                      {alternates.map((alt) => <li key={alt.resumeId}>{alt.resumeName || "Untitled resume"} — {alt.score}/100</li>)}
                    </ul>}
                  </div>
                  <div className={styles.scores}>
                    <span className="badge" style={{ fontSize: 12.5 }}>ATS {item.ats_score ?? "—"}</span>
                    {item.ai_status === "scored" && item.ai_tier && <span className={`badge ${TIER_BADGE_CLASS[item.ai_tier]}`} style={{ fontSize: 13, padding: "6px 12px" }}>
                      {TIER_LABEL[item.ai_tier]}{item.ai_score != null ? ` · ${item.ai_score}` : ""}
                    </span>}
                    {item.ai_status === "scored" && !item.ai_tier && <span className="badge badge-warn" style={{ fontSize: 12.5 }}>
                      AI reviewed{item.ai_score != null ? ` · ${item.ai_score}` : ""}
                    </span>}
                    {item.ai_status === "failed" && <span className="badge badge-warn" style={{ fontSize: 12.5 }} title={item.ai_failure_reason ?? undefined}>
                      AI check unavailable
                    </span>}
                    {item.ai_status === "pending" && <span className="badge muted" style={{ fontSize: 12.5 }}>AI not yet attempted</span>}
                  </div>
                </div>

                {item.ai_reason && <p className={styles.reason}>{item.ai_reason}</p>}
                {!item.ai_reason && item.ai_status === "failed" && <p className={`muted ${styles.reason}`}>
                  AI eligibility check could not complete: {item.ai_failure_reason || "unknown error"}. Showing the ATS score only — approve on that basis, or retry the AI check below.
                </p>}

                {item.hard_gates?.length > 0 && <ul className={styles.warnings} aria-label="Eligibility warnings">
                  {item.hard_gates.map((gate, i) => <li key={i} className={styles.warning}><AlertTriangle size={16} aria-hidden="true" /><span>{gate}</span></li>)}
                </ul>}

                {item.status === "rejected" && item.review_note && <p className={`muted ${styles.reviewNote}`}>
                  Rejected by {item.reviewed_by_name || "a reviewer"}{item.reviewed_at ? ` on ${formatDate(item.reviewed_at)}` : ""}: {item.review_note}
                </p>}

                <div className={styles.cardFooter}>
                  <div className={styles.jobLinks}>
                    {item.apply_url && <a className={`btn-secondary ${styles.action}`} href={item.apply_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Open job
                    </a>}
                    {item.application_id && <Link className={`btn-primary ${styles.action}`} href="/application-queue">View application</Link>}
                  </div>
                  {item.status === "pending" && <div className={styles.actions}>
                    {item.ai_status === "failed" && <button className={`btn-secondary ${styles.action}`} disabled={busy === item.id} onClick={() => void retryAi(item.id)}>
                      {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Retry AI check
                    </button>}
                    <button className={`btn-secondary ${styles.action}`} disabled={busy === item.id} onClick={() => void decide(item.id, "reject")}>
                      <XCircle size={14} /> Reject
                    </button>
                    <button className={`btn-primary ${styles.action}`} disabled={busy === item.id} onClick={() => void decide(item.id, "approve")}>
                      {busy === item.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve & start AI workflow
                    </button>
                  </div>}
                </div>
              </section>;
            })}
          </div>}
  </div>;
}
