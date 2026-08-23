"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const EmailActionModal = dynamic(() => import("./EmailActionModal"), { ssr: false });

export interface ApprovalItem {
  id: string;
  candidate_id: string;
  candidate_name: string;
  application_id: string | null;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  created_at: string;
  due_at: string | null;
  proposed_status: string | null;
  proposed_from_status: string | null;
  ai_confidence: number | null;
  decision: string | null;
  email_id?: string | null;
  subject?: string | null;
  from_email?: string | null;
  gmail_thread_id?: string | null;
  ai_summary?: string | null;
  application_current_status?: string | null;
  job_title?: string | null;
  company_name?: string | null;
}

function label(status: string | null | undefined) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** A proposal an AE hasn't decided yet, with an inline Approve/Reject
 *  action. Used both inline in /inbox's thread detail pane (compact) and
 *  as the primary list item on /inbox/approvals (full). */
export default function ApprovalCard({
  item, compact, selected, onToggleSelect, onDecided, onDecideStart, onDecideEnd,
}: {
  item: ApprovalItem;
  compact?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onDecided: (id: string, outcome: { decision: "approved" | "rejected"; ok: boolean; error?: string }) => void;
  /** Lets a parent list track "is any decision in flight" across all its
   *  cards, so a background poll can skip merging while one is pending -
   *  otherwise a poll mid-decision could resurrect a row the AE is in the
   *  middle of approving/rejecting. Optional: /inbox's single compact card
   *  doesn't need this, only /inbox/approvals's list does. */
  onDecideStart?: (id: string) => void;
  onDecideEnd?: (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const superseded = Boolean(
    item.application_current_status && item.proposed_from_status && item.application_current_status !== item.proposed_from_status,
  );

  async function decide(decision: "approved" | "rejected") {
    setBusy(decision);
    setError(null);
    onDecideStart?.(item.id);
    try {
      const res = await fetch(`/api/inbox/approvals/${item.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not record this decision.");
        onDecided(item.id, { decision, ok: false, error: data.error });
        return;
      }
      onDecided(item.id, { decision, ok: true });
    } catch (err: any) {
      setError(err?.message || "Network error.");
      onDecided(item.id, { decision, ok: false, error: err?.message });
    } finally {
      setBusy(null);
      onDecideEnd?.(item.id);
    }
  }

  const mailUrl = item.gmail_thread_id ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.gmail_thread_id)}` : null;

  return (
    <div className="card" style={{ padding: compact ? 12 : 16, border: "1px solid rgba(139,92,246,0.35)", background: "linear-gradient(135deg, rgba(139,92,246,0.06), var(--surface))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
          {onToggleSelect && (
            <input type="checkbox" checked={Boolean(selected)} onChange={() => onToggleSelect(item.id)} style={{ marginTop: 3, width: "auto" }} />
          )}
          <div style={{ minWidth: 0 }}>
            <Link href={`/candidates/${item.candidate_id}`} className="link" style={{ fontWeight: 700, fontSize: compact ? 13 : 14, color: "var(--ink)", textDecoration: "none" }}>
              {item.candidate_name}
            </Link>
            {(item.job_title || item.company_name) && (
              <div className="text-muted-foreground" style={{ fontSize: 12 }}>
                {item.application_id ? (
                  <Link href={`/applications/${item.application_id}`} target="_blank" className="link" style={{ textDecoration: "none", color: "inherit" }}>
                    {item.job_title}{item.job_title && item.company_name ? " at " : ""}{item.company_name} ↗
                  </Link>
                ) : (
                  <>{item.job_title}{item.job_title && item.company_name ? " at " : ""}{item.company_name}</>
                )}
              </div>
            )}
          </div>
        </div>
        <span className={`badge badge-priority-${item.priority}`}>{item.priority}</span>
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)" }}>
          {label(item.proposed_from_status)} → {label(item.proposed_status)}
        </span>
        {item.ai_confidence !== null && item.ai_confidence !== undefined && (
          <span className="text-muted-foreground" style={{ fontSize: 12 }}>{Math.round(Number(item.ai_confidence) * 100)}% confidence</span>
        )}
      </div>

      {item.subject && <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink)" }}>&ldquo;{item.subject}&rdquo;</div>}
      {item.ai_summary && <div style={{ marginTop: 4, fontSize: 12 }} className="text-muted-foreground">{item.ai_summary}</div>}

      {superseded && !item.decision && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(var(--warn-rgb), 0.12)", border: "1px solid rgba(var(--warn-rgb), 0.4)", fontSize: 12, color: "var(--warn)" }}>
          This application already moved to &ldquo;{label(item.application_current_status)}&rdquo; since this proposal was created.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(var(--danger-rgb), 0.1)", border: "1px solid rgba(var(--danger-rgb), 0.4)", fontSize: 12, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {mailUrl && <a className="btn" href={mailUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open in Gmail</a>}
        
        {item.decision ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {(item.decision === "approved" || item.decision === "auto_approved") && (
              <div style={{ fontSize: 13, color: "var(--success, #16a34a)", display: "flex", alignItems: "center", gap: 6 }}>
                ✓ Status updated
                <Link href={`/candidates/${item.candidate_id}#application-${item.application_id}`} className="link" style={{ fontSize: 12, textDecoration: "underline" }}>
                  View dashboard
                </Link>
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: item.decision === "approved" || item.decision === "auto_approved" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)" }}>
              Decision: {label(item.decision)}
            </div>
            {item.email_id && (
              <button className="btn outline sm" onClick={() => setShowModal(true)}>Show Details</button>
            )}
          </div>
        ) : (
          <>
            {item.email_id && (
              <button className="btn outline sm" onClick={() => setShowModal(true)} style={{ marginRight: "auto" }}>Show Details</button>
            )}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
              style={{ flex: 1, minWidth: 140, fontSize: 12, padding: "7px 10px" }}
            />
            <button className="btn-primary" disabled={busy !== null} onClick={() => decide("approved")}>
              {busy === "approved" ? "Approving…" : "Approve"}
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => decide("rejected")}>
              {busy === "rejected" ? "Rejecting…" : "Reject"}
            </button>
          </>
        )}
      </div>

      {showModal && item.email_id && (
        <EmailActionModal
          thread={{
            id: item.email_id,
            candidate_id: item.candidate_id,
            candidate_name: item.candidate_name,
            gmail_thread_id: item.gmail_thread_id,
            subject: item.subject,
            from_email: item.from_email,
            job_title: item.job_title,
            company_name: item.company_name,
            sent_at: item.created_at,
          }}
          candidates={[]}
          onClose={() => setShowModal(false)}
          onUpdated={() => {
            // Can trigger a refresh if needed
          }}
        />
      )}
    </div>
  );
}
