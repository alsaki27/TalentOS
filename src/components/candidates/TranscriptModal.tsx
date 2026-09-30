"use client";
import { useState } from "react";
import { X, Edit3, Sparkles, Send } from "lucide-react";
import type { MockSessionData } from "./MockSessionForm";
import { getScoreColor } from "./MockSessionForm";

function getWordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, width: "94vw", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Mock Interview Transcript</h2>
              {session.overall_score !== null && (
                <span style={{ background: `${getScoreColor(session.overall_score)}20`, color: getScoreColor(session.overall_score), fontWeight: 800, fontSize: 13, padding: "2px 8px", borderRadius: 6 }}>
                  {session.overall_score} / 10
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
              {candidateName} · {session.session_date} · {session.round_type ?? "—"} · {session.created_by ?? "—"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!editing && (
              <button className="btn-compact" onClick={() => { setDraft(session.transcript_raw_text ?? ""); setEditing(true); }}>
                <Edit3 size={14} /> {hasTranscript ? "Edit" : "Add"} transcript
              </button>
            )}
            <button className="btn-compact" onClick={onClose}><X size={14} /> Close</button>
          </div>
        </div>

        {editing ? (
          <div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Paste the full interview transcript from Teams, Zoom, or Google Meet — it's cleaned and organized by speaker automatically on save.
            </p>
            <textarea
              className="input"
              rows={16}
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste full interview transcript copy-paste here from Teams, Zoom, or Google Meet..."
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>{getWordCount(draft)} words</span>
              <div style={{ display: "flex", gap: 8 }}>
                {hasTranscript && <button className="btn-compact" onClick={() => setEditing(false)}>Cancel</button>}
                {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
                <button className="btn-primary" onClick={save} disabled={saving || !draft.trim()}>
                  <Send size={14} /> {saving ? "Saving…" : "Save Transcript"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ background: "var(--bg)", padding: 16, borderRadius: 10, border: "1px solid var(--border)", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, maxHeight: "60vh", overflowY: "auto" }}>
            {session.transcript_raw_text}
          </div>
        )}
      </div>
    </div>
  );
}
