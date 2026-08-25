"use client";

import React, { useState, useEffect, useRef } from "react";
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

type Tab = "details" | "reply" | "draft" | "attachments" | "team";

export default function EmailActionModal({ thread, candidates, onClose, onUpdated }: EmailActionModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [detail, setDetail] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  const [replyTo, setReplyTo] = useState(thread.from_email || "");
  const [replySubject, setReplySubject] = useState(thread.subject ? (thread.subject.toLowerCase().startsWith("re:") ? thread.subject : `Re: ${thread.subject}`) : "Re: ");
  const [replyBody, setReplyBody] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  
  const [handoverAssigneeId, setHandoverAssigneeId] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [handoverPriority, setHandoverPriority] = useState<"normal" | "high" | "urgent">("normal");
  
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [mounted, setMounted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    // Load detail
    fetch(`/api/gmail-communications/${thread.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setDetail(data));

    // Load templates
    fetch("/api/email-templates?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTemplates(Array.isArray(data) ? data : data.items ?? []));

    // Load drafts
    loadDrafts();

    // Load team
    fetch("/api/users?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTeamMembers(Array.isArray(data) ? data : data.items ?? []));
  }, [thread.id]);

  const loadDrafts = () => {
    fetch(`/api/inbox/drafts?candidateId=${thread.candidate_id}&threadId=${thread.gmail_thread_id}`)
      .then((r) => (r.ok ? r.json() : { drafts: [] }))
      .then((data) => setDrafts(data.drafts || []));
  };

  const candidateName = thread.candidate_name || "Unknown Candidate";

  const handleTemplateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tid = e.target.value;
    setSelectedTemplateId(tid);
    if (!tid) return;
    const tmpl = templates.find((t) => t.id === tid);
    if (tmpl) {
      let b = tmpl.body || "";
      let s = tmpl.subject || "";
      // Replace simple merge tags
      b = b.replace(/{{candidate_name}}/g, candidateName);
      b = b.replace(/{{job_title}}/g, thread.job_title || "");
      b = b.replace(/{{company_name}}/g, thread.company_name || "");
      setReplyBody(b);
      // We keep replySubject as "Re: " + original usually, but if template has subject, maybe use it
      if (s) setReplySubject(s.replace(/{{candidate_name}}/g, candidateName));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const validFiles = newFiles.filter(f => f.size <= 10485760);
      if (validFiles.length < newFiles.length) {
        alert("Some files were skipped because they exceed the 10MB limit.");
      }
      setAttachedFiles(prev => [...prev, ...validFiles].slice(0, 3));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadAttachments = async (): Promise<string[]> => {
    if (attachedFiles.length === 0) return [];
    const formData = new FormData();
    formData.append("candidate_id", thread.candidate_id);
    attachedFiles.forEach(f => formData.append("files", f));
    
    const res = await fetch("/api/email/send", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to upload attachments");
    return data.attachment_urls || [];
  };

  const handleSend = async (draftId?: string) => {
    setError("");
    setSuccessMessage("");
    setSending(true);
    try {
      let attachmentUrls: string[] = [];
      if (!draftId && attachedFiles.length > 0) {
        attachmentUrls = await uploadAttachments();
      }

      const payload = {
        candidate_id: thread.candidate_id,
        to_email: replyTo,
        subject: replySubject,
        body: replyBody,
        reply_to_thread_id: thread.gmail_thread_id,
        draft_id: draftId,
        attachment_urls: attachmentUrls,
      };

      const res = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");

      setSuccessMessage(`✓ Sent via ${candidateName}'s Gmail`);
      setAttachedFiles([]);
      setReplyBody("");
      onUpdated();
      if (draftId) loadDrafts();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    setError("");
    setSuccessMessage("");
    setSavingDraft(true);
    try {
      const payload = {
        candidate_id: thread.candidate_id,
        to_email: replyTo,
        subject: replySubject,
        body: replyBody,
        email_communication_id: thread.id,
        gmail_thread_id: thread.gmail_thread_id,
        sync_to_gmail: true,
      };

      const res = await fetch("/api/inbox/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");

      setSuccessMessage("✓ Draft saved");
      setActiveTab("draft");
      loadDrafts();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDiscardDraft = async (id: string) => {
    if (!confirm("Are you sure you want to discard this draft?")) return;
    try {
      await fetch(`/api/inbox/drafts?id=${id}`, { method: "DELETE" });
      loadDrafts();
    } catch (e) {
      alert("Failed to discard draft");
    }
  };

  const handleEditDraft = (draft: any) => {
    setReplyTo(draft.to_email);
    setReplySubject(draft.subject);
    setReplyBody(draft.body);
    setActiveTab("reply");
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
          {(["details", "reply", "draft", "attachments", "team"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`btn text ${activeTab === t ? "active" : ""}`}
              style={{ borderBottom: activeTab === t ? "2px solid var(--accent)" : "none", borderRadius: 0, padding: "12px 16px", textTransform: "capitalize" }}
              onClick={() => setActiveTab(t)}
            >
              {t} {t === "draft" && drafts.length > 0 ? `(${drafts.length})` : ""}
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
                  📎 This email has {detail.message.attachment_metadata.length} attachments. To download them, click "Open Gmail ↗" below.
                </div>
              )}

              <details>
                <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Why AI classified this</summary>
                <pre style={{ fontSize: 11, background: "var(--bg)", padding: 12, borderRadius: 6, marginTop: 8, overflowX: "auto" }}>
                  {JSON.stringify(detail?.message?.ai_evidence, null, 2)}
                </pre>
              </details>

              <div style={{ padding: 0, backgroundColor: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", minHeight: "55vh", display: "flex", flexDirection: "column" }}>
                {detail?.message?.body_text ? (
                  <div style={{
                    padding: 28,
                    color: "#e5e7eb",
                    backgroundColor: "#111",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    fontSize: 15,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    wordWrap: "break-word",
                    flex: 1,
                    overflowY: "auto"
                  }}>
                    {detail.message.body_text}
                  </div>
                ) : (
                  <div style={{ padding: 24, color: "var(--muted)" }}>Loading email body...</div>
                )}
              </div>

            </div>
          )}

          {/* TAB: REPLY */}
          {activeTab === "reply" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">To</label>
                  <input className="input" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Subject</label>
                  <input className="input" value={replySubject} onChange={(e) => setReplySubject(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Template</label>
                <select className="input" value={selectedTemplateId} onChange={handleTemplateSelect}>
                  <option value="">(No template)</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <textarea 
                  className="input" 
                  style={{ flex: 1, minHeight: 300, resize: "vertical", fontFamily: "monospace", fontSize: 13 }}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Type your message here..."
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button className="btn outline" onClick={handleSaveDraft} disabled={savingDraft || sending}>
                  {savingDraft ? "Saving..." : "Save as Draft"}
                </button>
                <button className="btn primary" onClick={() => handleSend()} disabled={sending || savingDraft}>
                  {sending ? "Sending..." : `Send via ${candidateName.split(' ')[0]}'s Gmail →`}
                </button>
              </div>
            </div>
          )}

          {/* TAB: DRAFT */}
          {activeTab === "draft" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>Drafts for {candidateName}</h3>
                <button className="btn outline sm" onClick={() => setActiveTab("reply")}>+ New Draft</button>
              </div>
              {drafts.length === 0 ? (
                <div className="text-muted">No unsent drafts.</div>
              ) : (
                drafts.map(d => (
                  <div key={d.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 6, backgroundColor: "var(--bg)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.subject}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Saved {new Date(d.created_at).toLocaleString()}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn text sm" onClick={() => handleEditDraft(d)}>Edit draft</button>
                      <button className="btn outline sm" onClick={() => handleSend(d.id)} disabled={sending}>{sending ? "..." : "Send now"}</button>
                      <button className="btn text sm" style={{ color: "var(--danger)" }} onClick={() => handleDiscardDraft(d.id)}>Discard ×</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB: ATTACHMENTS */}
          {activeTab === "attachments" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <h3 style={{ margin: "0 0 12px" }}>Incoming attachments (from this email)</h3>
                {hasAttachments ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.message.attachment_metadata.map((a: any, i: number) => (
                      <div key={i} style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, backgroundColor: "var(--bg)", display: "flex", gap: 12 }}>
                        <span>📎</span>
                        <div>
                          <div>{a.filename}</div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{Math.round((a.size || 0)/1024)} KB &middot; {a.mimeType}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
                      ⓘ To download: click "Open Gmail ↗" below. Gmail will open this email directly with download links.
                    </div>
                  </div>
                ) : (
                  <div className="text-muted">No attachments in this email.</div>
                )}
              </div>
              <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />
              <div>
                <h3 style={{ margin: "0 0 12px" }}>Send attachments with your reply</h3>
                <div style={{ marginBottom: 12 }}>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} style={{ display: "none" }} />
                  <button className="btn outline" onClick={() => fileInputRef.current?.click()} disabled={attachedFiles.length >= 3}>
                    Choose files...
                  </button>
                  <span style={{ marginLeft: 12, fontSize: 12, color: "var(--muted)" }}>(max 3 files, 10 MB each)</span>
                </div>
                {attachedFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {attachedFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, backgroundColor: "var(--bg)" }}>
                        <span>✓ {f.name} <span style={{ color: "var(--muted)", fontSize: 12 }}>({Math.round(f.size/1024)} KB)</span></span>
                        <button className="btn text sm" onClick={() => removeFile(i)}>×</button>
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                      Note: attachments will be uploaded when you click Send in the Reply tab.
                    </div>
                  </div>
                )}
              </div>
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
                      <div style={{ fontWeight: 600 }}>Assigned to: {teamMembers.find(m => m.user_id === a.assigned_to)?.display_name || "Unknown"}</div>
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
            <>
              {/* Approval/Reject are on the card itself, but we can duplicate or let user do it on the details tab */}
              <button className="btn primary sm" onClick={() => setActiveTab("details")}>View pending approval</button>
            </>
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
