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

function EmailBody({ bodyHtml, bodyText }: { bodyHtml: string | null | undefined; bodyText: string | null | undefined }) {
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
        srcDoc={`<base target="_blank">${bodyHtml}`}
        sandbox="allow-same-origin allow-popups"
        style={{ width: "100%", flex: 1, minHeight: "50vh", border: "none", background: "#fff", borderRadius: "0 0 6px 6px" }}
      />
    );
  }
  if (bodyText) {
    return (
      <div style={{
        padding: 28, color: "#e5e7eb", backgroundColor: "#111",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-wrap", wordWrap: "break-word",
        flex: 1, overflowY: "auto",
      }}>
        {bodyText}
      </div>
    );
  }
  return <div style={{ padding: 24, color: "var(--muted)" }}>Loading email body...</div>;
}

function ThreadMessage({ msg, expanded, onToggle }: { msg: any; expanded: boolean; onToggle: () => void }) {
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
          <EmailBody bodyHtml={msg.body_html} bodyText={msg.body_text} />
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch(`/api/gmail-communications/${thread.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setDetail(data);
        // Most recent message expanded by default, per the redesign's
        // "full thread view" requirement.
        const latest = data?.thread?.[data.thread.length - 1];
        if (latest) setExpandedThreadIds(new Set([latest.id]));
      });

    fetch("/api/users?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTeamMembers(Array.isArray(data) ? data : data.items ?? []));
  }, [thread.id]);

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

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100, backgroundColor: "rgba(0, 0, 0, 0.75)" }}>
      <div className="modal-content" style={{ width: "98vw", maxWidth: 1680, height: "95vh", maxHeight: "95vh", padding: 0, display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <button className="btn text sm" onClick={onClose}>← Back</button>
            <button className="btn text sm" onClick={onClose}>×</button>
          </div>
          <h2 style={{ fontSize: 20, margin: 0 }}>{thread.subject || "(no subject)"}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><strong>Candidate:</strong> {candidateName} &middot; {thread.candidate_email}</div>
            <div><strong>From:</strong> {thread.from_email} &middot; {new Date(thread.sent_at).toLocaleString()}</div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>Gmail Thread ID:</strong> <span style={{ fontFamily: "monospace" }}>{thread.gmail_thread_id}</span>
                {detail?.message?.candidate_match_method && (
                  <span style={{ marginLeft: 12 }}><strong>Matched by:</strong> {String(detail.message.candidate_match_method).replaceAll("_", " ")}</span>
                )}
              </div>
              {thread.job_title && (
                <div>
                  <strong>Matched Job:</strong> <span style={{ color: "var(--accent)" }}>{thread.job_title}</span>
                  {thread.company_name && <span> at {thread.company_name}</span>}
                </div>
              )}
            </div>
          </div>
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

          {/* TAB: DETAILS */}
          {activeTab === "details" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

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

              {/* Latest message, rendered in full (HTML when available, sandboxed) */}
              <div style={{ padding: 0, backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", minHeight: "50vh", display: "flex", flexDirection: "column" }}>
                <EmailBody bodyHtml={detail?.message?.body_html} bodyText={detail?.message?.body_text} />
              </div>

              {/* Full thread view - every message in this Gmail conversation,
                  chronological, collapsed except the latest. */}
              {detail?.thread?.length > 1 && (
                <div>
                  <h4 style={{ margin: "0 0 10px" }}>Full conversation ({detail.thread.length} messages)</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.thread.map((msg: any) => (
                      <ThreadMessage
                        key={msg.id}
                        msg={msg}
                        expanded={expandedThreadIds.has(msg.id)}
                        onToggle={() => toggleThreadMessage(msg.id)}
                      />
                    ))}
                  </div>
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
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", backgroundColor: "var(--bg)" }}>
          {detail?.gmailUrl && (
            <Link href={detail.gmailUrl} target="_blank" className="btn outline sm">Open Gmail ↗</Link>
          )}
          <button className="btn outline sm" onClick={markNotImportant}>Mark not important</button>

          {pendingProposal && (
            <button className="btn primary sm" onClick={() => setActiveTab("details")}>View pending approval</button>
          )}

          <button className="btn text sm" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={markUrgent}>
            Needs urgent reply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
