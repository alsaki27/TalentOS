"use client";
import { useMemo, useState } from "react";
import { X, Edit3, Sparkles, Send, Copy, Check, ZoomIn, ZoomOut, Search, MessageSquare } from "lucide-react";
import type { MockSessionData } from "./MockSessionForm";
import { getScoreColor } from "./MockSessionForm";
import { parseAndOrganizeTranscript, parseTranscriptToLines } from "@/lib/audit/transcriptParser";

function getWordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Distinct color per speaker name, stable across renders (evaluators lean red, everyone else purple — matches the source app's interviewer/candidate split, extended to handle more than two speakers cleanly). */
function speakerTheme(speaker: string, isCandidate: boolean) {
  if (!isCandidate) return { bubble: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.35)", avatar: "#dc2626", badgeText: "INTERVIEWER" };
  return { bubble: "rgba(99,102,241,0.14)", border: "rgba(99,102,241,0.35)", avatar: "#6366f1", badgeText: "CANDIDATE" };
}

export function TranscriptModal({
  candidateId,
  session,
  candidateName,
  onClose,
  onSaved,
}: {
  candidateId: string;
  session: MockSessionData;
  candidateName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasTranscript = !!session.transcript_raw_text?.trim();
  const [editing, setEditing] = useState(!hasTranscript);
  const [draft, setDraft] = useState(session.transcript_raw_text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [search, setSearch] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("all");

  const lines = useMemo(() => parseTranscriptToLines(session.transcript_raw_text ?? ""), [session.transcript_raw_text]);
  const speakers = useMemo(() => Array.from(new Set(lines.map((l) => l.speaker))), [lines]);

  const visibleLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (speakerFilter !== "all" && l.speaker !== speakerFilter) return false;
      if (q && !l.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, search, speakerFilter]);

  function copyText() {
    navigator.clipboard.writeText(session.transcript_raw_text ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_date: session.session_date,
          created_by: session.created_by,
          round_type: session.round_type,
          overall_score: session.overall_score,
          feedback_summary: session.feedback_summary,
          strengths_noted: session.strengths_noted,
          areas_for_improvement: session.areas_for_improvement,
          analysis_raw_text: session.raw_analysis_text,
          transcript_raw_text: draft,
        }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error || "Failed to save transcript");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Mock Interview Transcript Reader</h2>
              {session.overall_score !== null && (
                <span style={{ background: `${getScoreColor(session.overall_score)}20`, color: getScoreColor(session.overall_score), fontWeight: 800, fontSize: 13, padding: "2px 8px", borderRadius: 6 }}>
                  {session.overall_score} / {session.overall_score_max ?? 10}
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
              {candidateName} · {session.session_date} · Category: {session.round_type ?? "—"} · Evaluator: {session.created_by ?? "—"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", padding: "2px 6px", borderRadius: 8, border: "1px solid var(--border)" }}>
              <button type="button" className="btn-icon" onClick={() => setFontSize((s) => Math.max(12, s - 1))} title="Decrease text size"><ZoomOut size={14} /></button>
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: "center" }}>{fontSize}px</span>
              <button type="button" className="btn-icon" onClick={() => setFontSize((s) => Math.min(24, s + 1))} title="Increase text size"><ZoomIn size={14} /></button>
            </div>
            <button className="btn-compact" onClick={copyText} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {copied ? <Check size={14} color="#059669" /> : <Copy size={14} />} {copied ? "Copied" : "Copy Text"}
            </button>
            {!editing && (
              <button className="btn-compact" onClick={() => { setDraft(session.transcript_raw_text ?? ""); setEditing(true); }} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Edit3 size={14} /> Edit Transcript
              </button>
            )}
            <button className="btn-compact" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "hidden", paddingTop: 12, display: "flex", flexDirection: "column" }}>
          {editing ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>Paste Raw Transcript (Teams / Zoom / Meet supported):</label>
                <button type="button" className="btn-compact btn-sm" onClick={() => setDraft(parseAndOrganizeTranscript(draft))} style={{ display: "flex", alignItems: "center", gap: 6 }} title="Cleans speaker names, timestamps, and groups dialogue">
                  <Sparkles size={13} /> Auto-Clean &amp; Format
                </button>
              </div>
              <textarea
                className="input"
                style={{ flex: 1, width: "100%", fontFamily: "inherit", fontSize, lineHeight: 1.65, resize: "none" }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Paste full interview transcript copy-paste here from Teams, Zoom, or Google Meet..."
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>{getWordCount(draft)} words · {draft.length} characters</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {hasTranscript && <button className="btn-compact" onClick={() => setEditing(false)}>Cancel</button>}
                  {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
                  <button className="btn-primary" onClick={save} disabled={saving || !draft.trim()}>
                    <Send size={14} /> {saving ? "Saving…" : "Save Transcript"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {session.feedback_summary && (
                <div style={{ background: "var(--bg)", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>Mock Evaluation Summary</div>
                  <p style={{ margin: 0, fontSize: 13, fontStyle: "italic" }}>&quot;{session.feedback_summary}&quot;</p>
                </div>
              )}

              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
                <input
                  className="input"
                  style={{ width: "100%", paddingLeft: 32 }}
                  placeholder="Search words in transcript…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#7c3aed", display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare size={13} /> INTERVIEW DIALOGUE FEED
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn-compact btn-sm"
                    onClick={() => setSpeakerFilter("all")}
                    style={{ background: speakerFilter === "all" ? "#7c3aed" : undefined, color: speakerFilter === "all" ? "#fff" : undefined, borderColor: speakerFilter === "all" ? "#7c3aed" : undefined }}
                  >
                    All
                  </button>
                  {speakers.map((s) => (
                    <button
                      key={s}
                      className="btn-compact btn-sm"
                      onClick={() => setSpeakerFilter(s)}
                      style={{ background: speakerFilter === s ? "#7c3aed" : undefined, color: speakerFilter === s ? "#fff" : undefined, borderColor: speakerFilter === s ? "#7c3aed" : undefined }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {lines.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>No transcript text to display.</p>
                ) : visibleLines.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>No lines match your search.</p>
                ) : (
                  visibleLines.map((line) => {
                    const theme = speakerTheme(line.speaker, line.isCandidate);
                    return (
                      <div key={line.seq} style={{ display: "flex", justifyContent: line.isCandidate ? "flex-end" : "flex-start" }}>
                        <div style={{ display: "flex", gap: 8, maxWidth: "78%", flexDirection: line.isCandidate ? "row-reverse" : "row" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: theme.avatar, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                            {line.speaker.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, justifyContent: line.isCandidate ? "flex-end" : "flex-start" }}>
                              <strong style={{ fontSize: 12 }}>{line.speaker}</strong>
                              <span style={{ background: theme.avatar, color: "#fff", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4 }}>{theme.badgeText}</span>
                            </div>
                            <div style={{ background: theme.bubble, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "8px 12px", fontSize, lineHeight: 1.5 }}>
                              {line.text}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
