"use client";

import { useState } from "react";

// Relocated from candidate-dashboard/page.tsx (was EmailTaskRow there,
// feeding the old "AE email work queue" section removed in this chunk).
export interface EmailTask {
  id: string;
  candidate_id: string;
  candidate_name: string;
  application_id: string | null;
  type: string;
  title: string;
  description: string | null;
  suggested_action: string | null;
  priority: string;
  due_at: string | null;
  escalated_at: string | null;
  status: string;
  created_at: string;
  email_subject: string | null;
  email_sent_at: string | null;
  gmail_thread_id: string | null;
  job_title: string | null;
  company_name: string | null;
}

export default function EmailTaskRow({
  task, onUpdate,
}: {
  task: EmailTask;
  onUpdate: (id: string, status: string, note: string | undefined, takeover: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body_text: string } | null>(null);
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [applyUrl, setApplyUrl] = useState("");

  async function update(status: string, takeover: boolean) {
    setBusy(true);
    try { await onUpdate(task.id, status, note || undefined, takeover); } finally { setBusy(false); }
  }
  async function createDraft() {
    setBusy(true);
    try {
      const response = await fetch("/api/action-items/" + task.id + "/draft-reply", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create draft");
      setDraft(result.draft);
    } finally { setBusy(false); }
  }
  async function addApplication() {
    if (!company.trim() || !jobTitle.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/action-items/" + task.id + "/add-application", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, jobTitle, applyUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add application");
      // Adding an application already closes the task server-side (status='done',
      // resolution_kind='manual_resolution') - this call would just 400 on the
      // required-note guard for a second, redundant close. Refresh via onUpdate's
      // caller instead of re-issuing a status change here.
      await onUpdate(task.id, "done", "AE added the missing application to TalentOS.", false);
    } finally { setBusy(false); }
  }

  const mailUrl = task.gmail_thread_id ? "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(task.gmail_thread_id) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: "var(--ink)", fontSize: 13 }}>{task.title}</strong>
          <span className={`badge badge-priority-${task.priority}`}>{task.priority}</span>
        </div>
        <div style={{ marginTop: 4, color: "var(--ink-soft)", fontSize: 12 }}>
          {task.candidate_name}{task.job_title ? " · " + task.job_title : ""}{task.company_name ? " at " + task.company_name : ""}
        </div>
        {task.email_subject && <div style={{ marginTop: 4, color: "var(--ink)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>&ldquo;{task.email_subject}&rdquo;</div>}
        {task.description && <div style={{ marginTop: 4, color: "var(--ink-soft)", fontSize: 12 }}>{task.description}</div>}
        {task.type === "untracked_application" && (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, maxWidth: 700 }}>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" style={{ fontSize: 12 }} />
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title" style={{ fontSize: 12 }} />
            <input value={applyUrl} onChange={(e) => setApplyUrl(e.target.value)} placeholder="Application URL (optional)" style={{ fontSize: 12 }} />
          </div>
        )}
        {task.escalated_at && <div style={{ marginTop: 4, color: "var(--danger)", fontSize: 11, fontWeight: 800 }}>ESCALATED — overdue AE action</div>}
        {task.due_at && <div style={{ marginTop: 4, color: "var(--ink-soft)", fontSize: 11 }}>Due {new Date(task.due_at).toLocaleString()}</div>}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required note before resolving; optional when taking over" style={{ marginTop: 8, width: "100%", maxWidth: 620, fontSize: 12 }} />
        {draft && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <strong style={{ fontSize: 12 }}>Draft reply: {draft.subject}</strong>
            <textarea
              value={draft.body_text}
              onChange={(e) => setDraft({ subject: draft.subject, body_text: e.target.value })}
              style={{ display: "block", width: "100%", minHeight: 90, marginTop: 6, padding: 8, fontSize: 12, background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)", borderRadius: 6 }}
            />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 118 }}>
        {mailUrl && <a href={mailUrl} target="_blank" rel="noreferrer" className="btn" style={{ textAlign: "center", textDecoration: "none" }}>Open email</a>}
        {task.type === "untracked_application" && (
          <button className="btn-primary" disabled={busy || !company.trim() || !jobTitle.trim()} onClick={addApplication}>Add application</button>
        )}
        <button className="btn" disabled={busy} onClick={createDraft}>Draft reply</button>
        {/* Fixed from the pre-relocation bug: this page previously sent
            takeover:status==="done" for BOTH buttons, so every Resolve was
            recorded as manual_takeover and Take-over never was. */}
        <button className="btn" disabled={busy} onClick={() => update("in_progress", true)}>Take over</button>
        <button className="btn-primary" disabled={busy} onClick={() => update("done", false)}>Resolve</button>
      </div>
    </div>
  );
}
