// ARCHIVED 2026-09-07 — retired when TalentOS moved to a single shared,
// forward-only Gmail inbox (see Planning MD Files/"TalentOS — Single Shared
// Gmail Inbox Redesign 6 August 2026.md"). A forwarded message cannot be
// replied to from the account it landed in, so Reply/Draft capability was
// removed from src/app/inbox/components/EmailActionModal.tsx.
//
// This is a REFERENCE EXCERPT, not a standalone/importable component - the
// Reply and Draft tabs shared state, handlers, and a tab-switch with the
// rest of EmailActionModal, so they cannot be cleanly extracted into an
// independently compiling file without duplicating most of that component.
// To restore: merge the state/handlers/JSX below back into
// EmailActionModal.tsx, add "reply" | "draft" back to its Tab type and tab
// button list, restore the outgoing-attachment picker in the Attachments
// tab, and restore sendGmailMessage/createGmailDraft from
// src/lib/integrations/_archived/gmailSendApi.ts plus the two archived
// routes in src/server/services/_archived/inboxSendRoute.ts and
// inboxDraftsRoute.ts (move them back under src/app/api/inbox/send/route.ts
// and src/app/api/inbox/drafts/route.ts respectively).
// Original location: src/app/inbox/components/EmailActionModal.tsx

/*
// ---- state (in addition to what EmailActionModal.tsx still has) ----
const [templates, setTemplates] = useState<any[]>([]);
const [drafts, setDrafts] = useState<any[]>([]);
const [replyTo, setReplyTo] = useState(thread.from_email || "");
const [replySubject, setReplySubject] = useState(thread.subject ? (thread.subject.toLowerCase().startsWith("re:") ? thread.subject : `Re: ${thread.subject}`) : "Re: ");
const [replyBody, setReplyBody] = useState("");
const [selectedTemplateId, setSelectedTemplateId] = useState("");
const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
const [sending, setSending] = useState(false);
const [savingDraft, setSavingDraft] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);

// ---- effects ----
// Load templates
fetch("/api/email-templates?limit=100")
  .then((r) => (r.ok ? r.json() : []))
  .then((data) => setTemplates(Array.isArray(data) ? data : data.items ?? []));
// Load drafts
loadDrafts();

const loadDrafts = () => {
  fetch(`/api/inbox/drafts?candidateId=${thread.candidate_id}&threadId=${thread.gmail_thread_id}`)
    .then((r) => (r.ok ? r.json() : { drafts: [] }))
    .then((data) => setDrafts(data.drafts || []));
};

// ---- handlers ----
const handleTemplateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
  const tid = e.target.value;
  setSelectedTemplateId(tid);
  if (!tid) return;
  const tmpl = templates.find((t) => t.id === tid);
  if (tmpl) {
    let b = tmpl.body || "";
    let s = tmpl.subject || "";
    b = b.replace(/{{candidate_name}}/g, candidateName);
    b = b.replace(/{{job_title}}/g, thread.job_title || "");
    b = b.replace(/{{company_name}}/g, thread.company_name || "");
    setReplyBody(b);
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

  const res = await fetch("/api/email/send", { method: "POST", body: formData });
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

// ---- JSX: Reply tab ----
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

// ---- JSX: Draft tab ----
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

// ---- JSX: outgoing-attachment picker (lived inside the Attachments tab) ----
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
*/
