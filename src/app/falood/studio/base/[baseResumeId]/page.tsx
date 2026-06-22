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
import A4Preview from "@/components/resume/A4Preview";
import InlineDiffEditor, { type SectionResolution } from "@/components/InlineDiffEditor";

interface ResumeDocument {
  header: { fullName: string; location?: string; phone?: string; email?: string; linkedin?: string; github?: string; portfolio?: string };
  summary?: { id: string; text: string };
  skills: { id: string; title: string; skills: string[] }[];
  experience: { id: string; title: string; company: string; location?: string; startDate: string; endDate?: string; bullets: { id: string; text: string }[] }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: { id: string; title: string; description?: string; bullets: { id: string; text: string }[] }[];
  formatting?: any;
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

function mergeContent(original: ResumeDocument, proposed: ResumeDocument, resolutions: SectionResolution[]): ResumeDocument {
  const result: ResumeDocument = JSON.parse(JSON.stringify(original));
  for (const r of resolutions) {
    if (r.status !== "accepted") continue;
    switch (r.path) {
      case "header":
        result.header = proposed.header;
        break;
      case "summary":
        result.summary = proposed.summary;
        break;
      default: {
        const m = r.path.match(/^(\w+)\[(\d+)]$/);
        if (!m) break;
        const [, section, idxStr] = m;
        const idx = parseInt(idxStr, 10);
        const propArr = (proposed as any)[section] as any[];
        if (!Array.isArray((result as any)[section])) {
          (result as any)[section] = [];
        }
        const resultArr = (result as any)[section] as any[];
        if (idx < propArr.length) {
          if (idx < resultArr.length) {
            resultArr[idx] = propArr[idx];
          } else {
            resultArr.push(propArr[idx]);
          }
        }
        break;
      }
    }
  }
  return result;
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

  async function applyResolvedChanges(resolutions: SectionResolution[]) {
    if (!pendingAction?.newContent || !baseResumeId || !baseResume) return;
    const merged = mergeContent(baseResume.content, pendingAction.newContent, resolutions);
    const res = await fetch(`/api/base-resumes/${baseResumeId}/apply-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newContent: merged }),
    });
    if (res.ok) {
      const updated = await res.json();
      setBaseResume(updated);
      setJsonText(JSON.stringify(updated.content, null, 2));
      setPendingAction(null);
      setLog((prev) => [...prev, { role: "assistant", text: "Applied accepted changes to the draft." }]);
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

  // ... rest of the file

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

        {/* Draft / A4 Preview / Diff Editor */}
        <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexShrink: 0 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              {pendingAction ? "Review AI Changes" : showJsonEditor ? "JSON Editor" : "Resume Preview"}
              {pendingAction && <span className="badge" style={{ marginLeft: 8 }}>Pending review</span>}
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              {showJsonEditor && (
                <>
                  {jsonError && <span style={{ color: "var(--danger)", fontSize: 12 }}>● {jsonError}</span>}
                  <button className="btn-primary" onClick={saveJsonEditor} disabled={savingJson || !!jsonError}>
                    {savingJson ? "Saving…" : "Save Changes"}
                  </button>
                </>
              )}
              {!pendingAction && (
                <button className="btn" onClick={() => setShowJsonEditor((v) => !v)}>
                  {showJsonEditor ? "Hide JSON" : "Show JSON"}
                </button>
              )}
            </div>
          </div>

          {showJsonEditor && !pendingAction && (
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
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
                  minHeight: 200,
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
                Edit the JSON directly. Ctrl+S to save. The preview updates live.
              </p>
            </div>
          )}

          <div style={{ flex: 1, overflow: "hidden" }}>
            {pendingAction ? (
              <div style={{ height: "100%", overflowY: "auto" }}>
                <InlineDiffEditor
                  original={baseResume.content as any}
                  proposed={pendingAction.newContent! as any}
                  onResolve={(resolutions) => applyResolvedChanges(resolutions)}
                  onCancel={() => setPendingAction(null)}
                />
              </div>
            ) : (
              <A4Preview
                content={liveContent}
                highlights={[]}
                pageBreakY={1050}
              />
            )}
          </div>
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
