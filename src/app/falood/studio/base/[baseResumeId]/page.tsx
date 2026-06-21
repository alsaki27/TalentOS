// src/app/falood/studio/base/[baseResumeId]/page.tsx
// Base Resume CLI Studio (brief section 7). Three panes: candidate context, the
// structured draft (not a final PDF — see ROADMAP/PLAN), and the Falood CLI. Every
// command call returns a proposed action that must be explicitly applied — nothing
// the AI returns touches the saved draft until the user clicks "Apply".
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { exportAndDownloadResume } from "@/lib/falood/clientExport";

interface ResumeDocument {
  header: { fullName: string; location?: string; phone?: string; email?: string; linkedin?: string; github?: string; portfolio?: string };
  summary?: { id: string; text: string };
  skills: { id: string; title: string; skills: string[] }[];
  experience: { id: string; title: string; company: string; location?: string; startDate: string; endDate?: string; bullets: { id: string; text: string }[] }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
}

interface BaseResume {
  id: string;
  candidate_id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  content: ResumeDocument;
  updated_at: string;
}

interface Candidate {
  id: string;
  name: string;
  work_authorization: string | null;
}

interface EvidenceRow {
  id: string;
  title: string;
  description: string | null;
  source_type: string;
}

interface FaloodAction {
  type: "update_resume_document" | "create_warning";
  newContent?: ResumeDocument;
  reason?: string;
  warningType?: string;
  message?: string;
}

interface LogEntry {
  role: "user" | "assistant" | "warning";
  text: string;
}

const QUICK_COMMANDS = [
  "/create-base", "/make-skarion-style", "/organize-skills", "/improve-bullets",
  "/rewrite-summary", "/add-projects", "/remove-ai-slop", "/truth-check",
];

export default function BaseResumeStudioPage() {
  const params = useParams<{ baseResumeId: string }>();
  const baseResumeId = params?.baseResumeId;
  const [baseResume, setBaseResume] = useState<BaseResume | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<FaloodAction | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);

  async function load() {
    if (!baseResumeId) return;
    const res = await fetch(`/api/base-resumes/${baseResumeId}`);
    const data = await res.json();
    setBaseResume(data);
    if (data?.candidate_id) {
      const [candRes, evRes] = await Promise.all([
        fetch(`/api/candidates/${data.candidate_id}`),
        fetch(`/api/candidates/${data.candidate_id}/evidence`),
      ]);
      if (candRes.ok) setCandidate(await candRes.json());
      if (evRes.ok) setEvidence(await evRes.json());
    }
  }

  useEffect(() => { load(); }, [baseResumeId]);

  async function sendCommand(commandOrMessage: string, isCommand: boolean) {
    if (!baseResumeId || sending) return;
    setSending(true);
    setError("");
    setLog((prev) => [...prev, { role: "user", text: commandOrMessage }]);

    const res = await fetch("/api/falood/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "base_resume_creation",
        baseResumeId,
        candidateId: baseResume?.candidate_id,
        conversationId,
        ...(isCommand ? { command: commandOrMessage } : { message: commandOrMessage }),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setError(data.error || "Falood command failed.");
      setLog((prev) => [...prev, { role: "assistant", text: `(error) ${data.error ?? "request failed"}` }]);
      return;
    }

    setConversationId(data.conversationId);
    setLog((prev) => [...prev, { role: "assistant", text: data.message }]);
    (data.warnings ?? []).forEach((w: string) => setLog((prev) => [...prev, { role: "warning", text: w }]));
    if (data.action?.type === "update_resume_document") {
      setPendingAction(data.action);
    } else if (data.action?.type === "create_warning") {
      setLog((prev) => [...prev, { role: "warning", text: data.action.message }]);
    }
  }

  async function applyPendingAction() {
    if (!pendingAction?.newContent || !baseResumeId) return;
    const res = await fetch(`/api/base-resumes/${baseResumeId}/apply-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newContent: pendingAction.newContent }),
    });
    if (res.ok) {
      setBaseResume(await res.json());
      setPendingAction(null);
      setLog((prev) => [...prev, { role: "assistant", text: "Applied to the draft." }]);
    }
  }

  async function saveAsApproved() {
    if (!baseResumeId) return;
    const res = await fetch(`/api/base-resumes/${baseResumeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    if (res.ok) setBaseResume(await res.json());
  }

  if (!baseResume) return <div className="empty">Loading…</div>;

  const content = pendingAction?.newContent ?? baseResume.content;

  async function downloadBaseResume(format: "pdf" | "docx") {
    setExporting(format);
    try {
      // Base resumes aren't linked to an application, so there's no
      // application_resume_exports row to write - this is download-only, no R2
      // history, unlike the application-level export in the other studio page.
      await exportAndDownloadResume(content, format);
    } catch (err: any) {
      setError(err?.message || `${format.toUpperCase()} export failed.`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>{baseResume.name}</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn" href={`/candidates/${baseResume.candidate_id}`}>Back to candidate</Link>
          <Link className="btn" href={`/falood/cli-editor?type=base&id=${baseResume.id}`}>CLI Editor</Link>
          <span className="badge">{baseResume.status}</span>
          <button className="btn" onClick={() => downloadBaseResume("pdf")} disabled={exporting === "pdf"}>
            {exporting === "pdf" ? "Exporting…" : "Export PDF"}
          </button>
          <button className="btn" onClick={() => downloadBaseResume("docx")} disabled={exporting === "docx"}>
            {exporting === "docx" ? "Exporting…" : "Export DOCX"}
          </button>
          <button className="btn-primary" onClick={saveAsApproved} disabled={baseResume.status === "approved"}>
            Save as approved
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 320px", gap: 16, alignItems: "start" }}>
        {/* Candidate context */}
        <div className="card">
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Candidate context</h3>
          <p className="muted" style={{ fontSize: 13 }}>{candidate?.name}</p>
          <p className="muted" style={{ fontSize: 12 }}>Work auth: {candidate?.work_authorization ?? "—"}</p>
          <p className="muted" style={{ fontSize: 12 }}>Target: {baseResume.target_industry ?? "—"}</p>
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Evidence bank ({evidence.length})</h4>
          {evidence.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>No evidence yet.</p>
          ) : (
            <ul style={{ paddingLeft: 16, fontSize: 12 }}>
              {evidence.slice(0, 8).map((e) => <li key={e.id}>{e.title}</li>)}
            </ul>
          )}
        </div>

        {/* Draft */}
        <div className="card">
          <h3 style={{ fontSize: 14, marginTop: 0 }}>
            Base resume draft {pendingAction && <span className="badge" style={{ marginLeft: 8 }}>Proposed — not saved yet</span>}
          </h3>
          <h2 style={{ margin: "8px 0 0" }}>{content.header.fullName}</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {[content.header.location, content.header.phone, content.header.email, content.header.linkedin, content.header.portfolio].filter(Boolean).join(" | ")}
          </p>
          {content.summary?.text && <p style={{ fontSize: 13 }}>{content.summary.text}</p>}

          {content.skills.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, marginBottom: 4 }}>Technical Skills</h4>
              {content.skills.map((s) => (
                <p key={s.id} style={{ fontSize: 12, margin: "2px 0" }}><strong>{s.title}:</strong> {s.skills.join(", ")}</p>
              ))}
            </>
          )}

          {content.experience.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: "10px 0 4px" }}>Professional Experience</h4>
              {content.experience.map((exp) => (
                <div key={exp.id} style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 13, margin: 0 }}><strong>{exp.title}</strong> — {exp.company} {exp.location ? `(${exp.location})` : ""}</p>
                  <p className="muted" style={{ fontSize: 11, margin: 0 }}>{exp.startDate} – {exp.endDate ?? "Present"}</p>
                  <ul style={{ fontSize: 12, margin: "2px 0", paddingLeft: 16 }}>
                    {exp.bullets.map((b) => <li key={b.id}>{b.text}</li>)}
                  </ul>
                </div>
              ))}
            </>
          )}

          {content.education.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: "10px 0 4px" }}>Education</h4>
              {content.education.map((edu) => (
                <p key={edu.id} style={{ fontSize: 12, margin: "2px 0" }}>{edu.degree} — {edu.school} {edu.graduationDate ? `(${edu.graduationDate})` : ""}</p>
              ))}
            </>
          )}

          {pendingAction && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={applyPendingAction}>Apply this draft</button>
              <button onClick={() => setPendingAction(null)}>Discard</button>
            </div>
          )}
        </div>

        {/* Falood CLI */}
        <div className="card" style={{ display: "flex", flexDirection: "column", height: 600 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Falood CLI</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {QUICK_COMMANDS.map((c) => (
              <button key={c} style={{ fontSize: 11 }} onClick={() => sendCommand(c, true)} disabled={sending}>{c}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", marginBottom: 8, fontSize: 12 }}>
            {log.length === 0 && <p className="muted">Run /create-base to generate the first draft.</p>}
            {log.map((entry, i) => (
              <p key={i} style={{
                margin: "4px 0",
                color: entry.role === "warning" ? "var(--danger)" : undefined,
                fontWeight: entry.role === "user" ? 600 : 400,
              }}>
                {entry.role === "user" ? "> " : entry.role === "warning" ? "⚠ " : ""}{entry.text}
              </p>
            ))}
            {sending && <p className="muted">Falood is thinking…</p>}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command or instruction…"
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { sendCommand(input.trim(), input.trim().startsWith("/")); setInput(""); } }}
            />
            <button
              className="btn-primary"
              disabled={sending || !input.trim()}
              onClick={() => { sendCommand(input.trim(), input.trim().startsWith("/")); setInput(""); }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
