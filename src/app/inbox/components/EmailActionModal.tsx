"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import ApprovalCard from "./ApprovalCard";
import { resolveFaloodStudioUrl } from "@/lib/falood/openStudio";

// Using any for some types to avoid duplicating large interfaces
export interface EmailActionModalProps {
  thread: any;
  candidates: { id: string; name: string }[];
  onClose: () => void;
  onUpdated: () => void;
}

type Tab = "details" | "attachments" | "team";

function emailDocument(html: string) {
  const injected = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>
    html,body{width:100%!important;min-width:0!important;min-height:100%!important;margin:0!important;background:#fff!important;color:#202124!important}
    body{box-sizing:border-box!important;padding:24px clamp(16px,4vw,48px)!important;font:14px/1.65 Arial,Helvetica,sans-serif!important;overflow-wrap:anywhere!important}
    *,*:before,*:after{box-sizing:border-box} img,video,svg{max-width:100%!important;height:auto!important} table{max-width:100%!important}
    pre{max-width:100%!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important} a{color:#1a73e8}
  </style>`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${injected}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${injected}</head>`);
  return `<!doctype html><html><head>${injected}</head><body>${html}</body></html>`;
}

function EmailBody({ bodyHtml, bodyText, loading }: { bodyHtml: string | null | undefined; bodyText: string | null | undefined; loading: boolean }) {
  if (bodyHtml) {
    // Sandboxed, srcDoc-rendered iframe: the standard safe way to show
    // untrusted HTML mail without pulling in a sanitization library - no
    // scripts run, styles stay contained to the frame. allow-popups (beyond
    // the plan's baseline allow-same-origin) is needed so a target="_blank"
    // link inside the mail can actually open; the injected <base> forces
    // every link to open outside the iframe even when the original HTML
    // didn't set target itself.
    return (
      <iframe
        title="Email body"
        srcDoc={emailDocument(bodyHtml)}
        sandbox="allow-popups"
        style={{ width: "100%", flex: 1, minHeight: "58vh", border: "none", background: "#fff", borderRadius: "0 0 6px 6px" }}
      />
    );
  }
  if (bodyText) {
    return (
      <div style={{
        padding: 28, color: "#202124", backgroundColor: "#fff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-wrap", wordWrap: "break-word",
        flex: 1, overflowY: "auto",
      }}>
        {bodyText}
      </div>
    );
  }
  // This only reads "Loading" while a fetch is genuinely in flight - once it
  // resolves (success or failure) the label reflects the real end state
  // instead of leaving the user staring at "Loading..." forever with no way
  // to tell a stalled fetch apart from a message that simply has no body.
  return (
    <div style={{ padding: 24, color: "var(--muted)" }}>
      {loading ? "Loading email body..." : "No email body available for this message."}
    </div>
  );
}

function ThreadMessage({ msg, expanded, onToggle, loading }: { msg: any; expanded: boolean; onToggle: () => void; loading: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", backgroundColor: "var(--bg)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "var(--bg-inset)", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}
      >
        <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <strong>{msg.direction === "outbound" ? "Sent" : (msg.from_email || "Unknown sender")}</strong>
          {msg.snippet && !expanded ? ` — ${msg.snippet}` : ""}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{new Date(msg.sent_at).toLocaleString()} {expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <EmailBody bodyHtml={msg.body_html} bodyText={msg.body_text} loading={loading} />
        </div>
      )}
    </div>
  );
}

export default function EmailActionModal({ thread, candidates, onClose, onUpdated }: EmailActionModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [detail, setDetail] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());

  const [handoverAssigneeId, setHandoverAssigneeId] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [handoverPriority, setHandoverPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [handingOver, setHandingOver] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [savingReplyState, setSavingReplyState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    fetch(`/api/gmail-communications/${thread.id}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load this email (HTTP ${r.status}).`);
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        // Most recent message expanded by default, per the redesign's
        // "full thread view" requirement.
        const latest = data?.thread?.length ? data.thread[data.thread.length - 1] : null;
        if (latest) setExpandedThreadIds(new Set([latest.id]));
      })
      .catch((err: any) => {
        // Previously unhandled: a failed fetch here (network blip, session
        // expiry, a transient 500) left `detail` at its initial null forever
        // with no error shown - the email body area just said "Loading
        // email body..." indefinitely with no way to tell a stuck fetch
        // apart from one that never started. Surfacing the failure with a
        // retry path replaces that silent hang with an actionable message.
        if (!cancelled) setDetailError(err?.message || "Failed to load this email.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    fetch("/api/users?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTeamMembers(Array.isArray(data) ? data : data.items ?? []))
      .catch(() => {});

    return () => { cancelled = true; };
  }, [thread.id, retryNonce]);

  const candidateName = thread.candidate_name || "Unknown Candidate";

  const toggleThreadMessage = (id: string) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleHandover = async () => {
    if (!handoverAssigneeId) {
      setError("Please select an assignee");
      return;
    }
    setError("");
    setSuccessMessage("");
    setHandingOver(true);
    try {
      const res = await fetch("/api/inbox/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_communication_id: thread.id,
          assignee_user_id: handoverAssigneeId,
          note: handoverNote,
          priority: handoverPriority,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to handover email");

      const assigneeName = teamMembers.find(m => m.user_id === handoverAssigneeId)?.display_name || "team member";
      setSuccessMessage(`✓ Handed over to ${assigneeName}. They've been notified.`);
      setHandoverNote("");
      onUpdated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setHandingOver(false);
    }
  };

  const markNotImportant = async () => {
    try {
      const res = await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "noise" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to mark as not important");
        return;
      }
      onUpdated();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to mark as not important");
    }
  };

  const markReplied = async () => {
    setSavingReplyState(true);
    setError("");
    try {
      const res = await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "mark_replied" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not mark this email replied.");
      onUpdated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark this email replied.");
    } finally {
      setSavingReplyState(false);
    }
  };

  const markNoReplyNeeded = async () => {
    setSavingReplyState(true);
    setError("");
    try {
      const res = await fetch(`/api/gmail-communications/${thread.id}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "no_reply_needed" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not mark no reply needed.");
      onUpdated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark no reply needed.");
    } finally {
      setSavingReplyState(false);
    }
  };

  const markUrgent = async () => {
    if (!detail) return;
    const task = detail.actionItems.find((a: any) => a.type === "needs_reply" && a.status !== "done");
    if (!task) {
      setError("No open reply task on this thread to mark urgent.");
      return;
    }
    try {
      const res = await fetch(`/api/action-items/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "urgent" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to mark urgent");
        return;
      }
      onUpdated();
    } catch (e: any) {
      setError(e?.message || "Failed to mark urgent");
    }
  };

  const pendingProposal = detail?.actionItems.find((a: any) => a.type === "status_change_approval" && !a.decision);
  const statusChangeBadge = detail?.actionItems.find((a: any) => a.type === "status_change_approval" && (a.decision === 'approved' || a.decision === 'auto_approved'));
  const hasAttachments = detail?.message?.attachment_metadata?.length > 0;
  const replyStatus = detail?.message?.direction === "inbound" ? (() => {
    const message = detail.message;
    if (message.forwarded_candidate_reply) return { label: "Forwarded team reply detected", detail: "This message arrived from the candidate mailbox and was forwarded into the monitoring inbox.", color: "#15803d", background: "#f0fdf4", border: "#86efac" };
    if (message.detected_replied_at) return { label: "Team replied", detail: new Date(message.detected_replied_at).toLocaleString(), color: "#15803d", background: "#f0fdf4", border: "#86efac" };
    if (message.manual_replied_at) return { label: "Marked replied", detail: new Date(message.manual_replied_at).toLocaleString(), color: "#15803d", background: "#f0fdf4", border: "#86efac" };
    if (!message.needs_reply) return { label: "No reply needed", detail: "This message was marked informational.", color: "#475569", background: "#f8fafc", border: "#cbd5e1" };
    const ageHours = Math.max(0, (Date.now() - new Date(message.sent_at).getTime()) / 3_600_000);
    if (ageHours > 168) return { label: "Needs reply · older than 7 days", detail: "Outside the 7-day overdue reminder window.", color: "#475569", background: "#f8fafc", border: "#cbd5e1" };
    if (ageHours >= 24) return { label: "Overdue · 24+ hours", detail: "No later team reply detected.", color: "#b91c1c", background: "#fff7f7", border: "#f87171" };
    if (ageHours >= 12) return { label: "Waiting · 12+ hours", detail: "No later team reply detected.", color: "#1d4ed8", background: "#eff6ff", border: "#93c5fd" };
    return { label: "Needs reply", detail: "No later team reply detected.", color: "#6d28d9", background: "#f5f3ff", border: "#c4b5fd" };
  })() : null;

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100, backgroundColor: "rgba(0, 0, 0, 0.75)" }}>
      <div className="modal-content" style={{ width: "98vw", maxWidth: 1680, height: "95vh", maxHeight: "95vh", padding: 0, display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <button className="btn text sm" onClick={onClose}>← Back</button>
            <button className="btn text sm" onClick={onClose}>×</button>
          </div>
          <h2 style={{ fontSize: 21, lineHeight: 1.35, margin: 0, overflowWrap: "anywhere" }}>{thread.subject || "(no subject)"}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "6px 18px" }}>
            <div><strong>From:</strong> {thread.from_email || "Unknown sender"} &middot; {new Date(thread.sent_at).toLocaleString()}</div>
            <div><strong>Candidate:</strong> {candidateName}{thread.candidate_email ? ` · ${thread.candidate_email}` : ""}</div>
            <div><strong>Mailbox:</strong> forwarded monitoring view · replies are sent from the candidate mailbox</div>
            {thread.job_title && <div><strong>Related job:</strong> <span style={{ color: "var(--accent)" }}>{thread.job_title}</span>{thread.company_name && ` at ${thread.company_name}`}</div>}
          </div>
          <details style={{ fontSize: 11, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer" }}>Thread details</summary>
            <div style={{ marginTop: 6, fontFamily: "monospace", overflowWrap: "anywhere" }}>Gmail thread ID: {thread.gmail_thread_id}{detail?.message?.candidate_match_method ? ` · Matched by: ${String(detail.message.candidate_match_method).replaceAll("_", " ")}` : ""}</div>
          </details>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 24px" }}>
          {(["details", "attachments", "team"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`btn text ${activeTab === t ? "active" : ""}`}
              style={{ borderBottom: activeTab === t ? "2px solid var(--accent)" : "none", borderRadius: 0, padding: "12px 16px", textTransform: "capitalize" }}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24, backgroundColor: "var(--bg-inset)" }}>

          {error && <div className="alert error" style={{ marginBottom: 16 }}>{error}</div>}
          {successMessage && <div className="alert success" style={{ marginBottom: 16 }}>{successMessage}</div>}
          {detailError && (
            <div className="alert error" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>{detailError}</span>
              <button className="btn outline sm" onClick={() => setRetryNonce((n) => n + 1)}>Retry</button>
            </div>
          )}

          {/* TAB: DETAILS */}
          {activeTab === "details" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {replyStatus && (
                <div role="status" style={{ padding: 14, border: `1px solid ${replyStatus.border}`, borderRadius: 8, background: replyStatus.background, color: replyStatus.color }}>
                  <strong>{replyStatus.label}</strong><span> · {replyStatus.detail}</span>
                </div>
              )}

              {detail?.message?.ai_summary && (
                <div style={{ padding: 16, backgroundColor: "var(--accent-soft)", borderRadius: 6 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13, textTransform: "uppercase", color: "var(--accent)" }}>AI Summary</h4>
                  <p style={{ margin: 0, fontSize: 14 }}>{detail.message.ai_summary}</p>
                </div>
              )}

              {detail?.message?.ai_matched_application_id && (
                <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 6, backgroundColor: "var(--bg)" }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Linked application: </strong>
                    {detail.message.job_id ? (
                      <Link href={`/jobs/${detail.message.job_id}`} target="_blank" className="link">
                        {thread.job_title} at {thread.company_name} ↗
                      </Link>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Job link not found</span>
                    )}
                  </div>
                  <div>
                    <strong>Tailored resume: </strong>
                    {detail.message.resume_version_id ? (
                      <button
                        type="button"
                        className="link"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        onClick={async () => {
                          try {
                            const url = await resolveFaloodStudioUrl("application_resume_version", detail.message.resume_version_id);
                            window.open(url, "_blank");
                          } catch {
                            alert("Tailored resume link not found");
                          }
                        }}
                      >
                        View →
                      </button>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Tailored resume link not found</span>
                    )}
                  </div>
                </div>
              )}

              {statusChangeBadge && (
                <div style={{ padding: "8px 12px", backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 6, display: "inline-block" }}>
                  ✓ {statusChangeBadge.proposed_from_status} → {statusChangeBadge.proposed_status} (approved)
                </div>
              )}

              {pendingProposal && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", backgroundColor: "var(--bg)" }}>
                  <ApprovalCard
                    item={pendingProposal}
                    onDecided={() => onUpdated()}
                    compact
                  />
                </div>
              )}

              {hasAttachments && (
                <div style={{ padding: 12, backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
                  📎 This email has {detail.message.attachment_metadata.length} attachment(s). See the Attachments tab to view or download.
                </div>
              )}

              <details>
                <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Why AI classified this</summary>
                <pre style={{ fontSize: 11, background: "var(--bg)", padding: 12, borderRadius: 6, marginTop: 8, overflowX: "auto" }}>
                  {JSON.stringify(detail?.message?.ai_evidence, null, 2)}
                </pre>
              </details>

              {/* A single message uses the spacious reader. For a thread,
                  render each message exactly once below so the newest message
                  is not duplicated outside the chronological conversation. */}
              {detail?.thread?.length > 1 ? (
                <div>
                  <h4 style={{ margin: "0 0 10px" }}>Full conversation ({detail.thread.length} messages)</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.thread.map((msg: any) => (
                      <ThreadMessage
                        key={msg.id}
                        msg={msg}
                        expanded={expandedThreadIds.has(msg.id)}
                        onToggle={() => toggleThreadMessage(msg.id)}
                        loading={detailLoading}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 0, backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", minHeight: "50vh", display: "flex", flexDirection: "column" }}>
                  <EmailBody bodyHtml={detail?.message?.body_html} bodyText={detail?.message?.body_text} loading={detailLoading} />
                </div>
              )}

            </div>
          )}

          {/* TAB: ATTACHMENTS */}
          {activeTab === "attachments" && (
            <div>
              <h3 style={{ margin: "0 0 12px" }}>Attachments</h3>
              {hasAttachments ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detail.message.attachment_metadata.map((a: any, i: number) => {
                    const canFetch = Boolean(a.attachmentId && detail?.message?.gmail_message_id);
                    const baseUrl = canFetch
                      ? `/api/gmail/attachments/${encodeURIComponent(detail.message.gmail_message_id)}/${encodeURIComponent(a.attachmentId)}`
                      : null;
                    return (
                      <div key={i} style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, backgroundColor: "var(--bg)", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                          <span>📎</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>{Math.round((a.size || 0) / 1024)} KB &middot; {a.mimeType}</div>
                          </div>
                        </div>
                        {baseUrl ? (
                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <Link href={baseUrl} target="_blank" className="btn outline sm">View</Link>
                            <Link href={`${baseUrl}?download=1`} className="btn outline sm">Download</Link>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>Unavailable</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-muted">No attachments in this email.</div>
              )}
            </div>
          )}

          {/* TAB: TEAM */}
          {activeTab === "team" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ padding: 20, backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <h3 style={{ margin: "0 0 16px" }}>Handover this email to a team member</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <label className="label">Assign to</label>
                    <select className="input" value={handoverAssigneeId} onChange={(e) => setHandoverAssigneeId(e.target.value)}>
                      <option value="">Select team member...</option>
                      {teamMembers.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Priority</label>
                    <select className="input" value={handoverPriority} onChange={(e) => setHandoverPriority(e.target.value as any)}>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Note</label>
                    <textarea className="input" value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} placeholder="Optional note for the assignee..." rows={3} />
                  </div>
                  <div>
                    <button className="btn primary" onClick={handleHandover} disabled={handingOver}>
                      {handingOver ? "Handing over..." : "Handover →"}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 12px" }}>Existing handovers for this thread:</h4>
                {detail?.actionItems?.filter((a: any) => a.type === "team_handover").length > 0 ? (
                  detail.actionItems.filter((a: any) => a.type === "team_handover").map((a: any) => (
                    <div key={a.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 6, marginBottom: 8 }}>
                      {/* Fixed field-name bug: this used to read a.assigned_to,
                          which does not exist on action_items (the real
                          column is assigned_to_user_id) - always showed
                          "Unknown". */}
                      <div style={{ fontWeight: 600 }}>Assigned to: {teamMembers.find(m => m.user_id === a.assigned_to_user_id)?.display_name || "Unknown"}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0" }}>Priority: {a.priority} &middot; Status: {a.status} &middot; {new Date(a.created_at).toLocaleString()}</div>
                      {a.description && <div style={{ fontSize: 13 }}>Note: "{a.description}"</div>}
                    </div>
                  ))
                ) : (
                  <div className="text-muted">No handovers for this thread.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="email-action-modal-footer" style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", backgroundColor: "var(--bg)" }}>
          {detail?.gmailUrl && (
            <Link href={detail.gmailUrl} target="_blank" className="btn outline sm">View original in Gmail ↗</Link>
          )}
          <button className="btn outline sm" onClick={markNotImportant}>Mark not important</button>
          {(detail?.message?.direction || thread.direction) === "inbound" && (detail?.message?.needs_reply ?? thread.needs_reply) && !(detail?.message?.detected_replied_at || detail?.message?.manual_replied_at || thread.effective_replied_at || thread.detected_replied_at) && <button className="btn-primary sm" disabled={savingReplyState} onClick={() => void markReplied()}>{savingReplyState ? "Saving…" : "Mark replied"}</button>}
          {(detail?.message?.direction || thread.direction) === "inbound" && (detail?.message?.needs_reply ?? thread.needs_reply) && !(detail?.message?.detected_replied_at || detail?.message?.replied_at || detail?.message?.manual_replied_at || thread.effective_replied_at || thread.detected_replied_at) ? <button className="btn outline sm" disabled={savingReplyState} onClick={() => void markNoReplyNeeded()}>{savingReplyState ? "Saving…" : "No reply needed"}</button> : null}

          {pendingProposal && (
            <button className="btn primary sm" onClick={() => setActiveTab("details")}>View pending approval</button>
          )}

          <button className="btn text sm email-modal-urgent-action" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={markUrgent}>
            Needs urgent reply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
