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

  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savingJson, setSavingJson] = useState(false);

  async function load() {
    if (!baseResumeId) return;
    const res = await fetch(`/api/base-resumes/${baseResumeId}`);
    const data = await res.json();
    setBaseResume(data);
    setJsonText(JSON.stringify(data.content, null, 2));
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

  // Keyboard shortcut: Ctrl+S saves JSON editor when it's open. Must be declared
  // here, before the `if (!baseResume) return ...` early return below - React
  // hooks must run in the same order on every render, and a hook placed after an
  // early return gets skipped whenever that return fires (e.g. on first render
  // while baseResume is still loading), which is a real rules-of-hooks violation,
  // not just a lint nitpick.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && showJsonEditor) {
        e.preventDefault();
        saveJsonEditor();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showJsonEditor, jsonText, jsonError]);

  async function saveJsonEditor() {
    if (!baseResumeId || jsonError) return;
    try {
      const newContent = JSON.parse(jsonText) as ResumeDocument;
      setSavingJson(true);
      const res = await fetch(`/api/base-resumes/${baseResumeId}/apply-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newContent }),
      });
      if (res.ok) {
        setBaseResume(await res.json());
        setJsonError(null);
      }
      setSavingJson(false);
    } catch (err: any) {
      setJsonError(err.message ?? "Invalid JSON");
      setSavingJson(false);
    }
  }

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

  // Live preview from JSON editor
  const liveContent = (() => {
    if (!showJsonEditor) return content;
    try {
      return JSON.parse(jsonText) as ResumeDocument;
    } catch {
      return content;
    }
  })();

  async function downloadBaseResume(format: "pdf" | "docx") {
    setExporting(format);
    try {
      await exportAndDownloadResume(liveContent, format);
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
          <button className="btn" onClick={() => setShowJsonEditor((v) => !v)}>
            {showJsonEditor ? "Hide JSON Editor" : "Show JSON Editor"}
          </button>
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

        {/* Draft / JSON Editor */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              {showJsonEditor ? "JSON Editor" : "Base resume draft"}
              {pendingAction && <span className="badge" style={{ marginLeft: 8 }}>Proposed — not saved yet</span>}
            </h3>
            {showJsonEditor && (
              <div style={{ display: "flex", gap: 8 }}>
                {jsonError && <span style={{ color: "var(--danger)", fontSize: 12 }}>● {jsonError}</span>}
                <button className="btn-primary" onClick={saveJsonEditor} disabled={savingJson || !!jsonError}>
                  {savingJson ? "Saving…" : "Save Changes"}
                </button>
              </div>
            )}
          </div>

          {showJsonEditor && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  try {
                    JSON.parse(e.target.value);
                    setJsonError(null);
                  } catch (err: any) {
                    setJsonError(err.message ?? "Invalid JSON");
                  }
                }}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 300,
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: 10,
                  border: jsonError ? "1px solid var(--danger)" : "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  resize: "vertical",
                }}
              />
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Edit the JSON directly. The preview below updates live. Ctrl+S to save.
              </p>
            </div>
          )}

          {/* Live Preview */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg)" }}>
            <h4 style={{ fontSize: 12, margin: "0 0 8px", color: "var(--muted)" }}>Live Preview</h4>
            <h2 style={{ margin: "8px 0 0" }}>{liveContent.header.fullName}</h2>
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {[liveContent.header.location, liveContent.header.phone, liveContent.header.email, liveContent.header.linkedin, liveContent.header.portfolio].filter(Boolean).join(" | ")}
            </p>
            {liveContent.summary?.text && <p style={{ fontSize: 13 }}>{liveContent.summary.text}</p>}

            {liveContent.skills.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, marginBottom: 4 }}>Technical Skills</h4>
                {liveContent.skills.map((s) => (
                  <p key={s.id} style={{ fontSize: 12, margin: "2px 0" }}><strong>{s.title}:</strong> {s.skills.join(", ")}</p>
                ))}
              </>
            )}

            {liveContent.experience.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, margin: "10px 0 4px" }}>Professional Experience</h4>
                {liveContent.experience.map((exp) => (
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

            {liveContent.education.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, margin: "10px 0 4px" }}>Education</h4>
                {liveContent.education.map((edu) => (
                  <p key={edu.id} style={{ fontSize: 12, margin: "2px 0" }}>{edu.degree} — {edu.school} {edu.graduationDate ? `(${edu.graduationDate})` : ""}</p>
                ))}
              </>
            )}
          </div>

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
