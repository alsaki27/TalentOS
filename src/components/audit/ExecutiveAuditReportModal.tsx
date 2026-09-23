"use client";
import { useState } from "react";
import { X, Save, Edit3 } from "lucide-react";
import { ExecutiveAuditReportCard } from "./ExecutiveAuditReportCard";

interface Props {
  onClose: () => void;
  candidateId: string;
  sessionId: string;
  rawText: string | null;
  candidateName?: string;
  targetRole?: string | null;
  onSaved: () => void;
}

export function ExecutiveAuditReportModal({ onClose, candidateId, sessionId, rawText, candidateName, targetRole, onSaved }: Props) {
  const [isEditing, setIsEditing] = useState(!rawText);
  const [draft, setDraft] = useState(rawText || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit/mock-sessions/${sessionId}/analysis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_analysis_text: draft }),
      });
      if (!res.ok) {
        const body = await res.text();
        setError(body || "Failed to save analysis");
        return;
      }
      setIsEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920, width: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Executive Audit Report</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {!isEditing && (
              <button className="btn-compact" onClick={() => { setDraft(rawText || ""); setIsEditing(true); }}>
                <Edit3 size={14} /> Edit raw analysis
              </button>
            )}
            <button className="btn-compact" onClick={onClose}>
              <X size={14} /> Close
            </button>
          </div>
        </div>

        {isEditing ? (
          <div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Paste the structured audit analysis text (Overall Assessment / Performance Metrics / Strengths / Critical Weaknesses / Action Items). It will be parsed automatically.
            </p>
            <textarea
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              placeholder={"Candidate: ...\nTarget Role: ...\nOverall Assessment: 8.5 / 10 (...)\n\nPERFORMANCE METRICS:\n* Communication & Delivery: 9 / 10 (...)\n\nSTRENGTHS:\n* ...: ...\n\nCRITICAL WEAKNESSES:\n* ...: ... (Quote: \"...\") Correction: ...\n\nACTION ITEMS:\n* ...: ..."}
            />
            {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-primary" onClick={save} disabled={saving || !draft.trim()}>
                <Save size={14} /> {saving ? "Saving..." : "Save & parse"}
              </button>
              {rawText && (
                <button className="btn-compact" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <ExecutiveAuditReportCard rawText={rawText} candidateName={candidateName} targetRole={targetRole} />
        )}
      </div>
    </div>
  );
}
