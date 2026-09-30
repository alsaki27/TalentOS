"use client";
import { useState } from "react";
import { X, Save, Edit3, SlidersHorizontal, Paperclip, Trash2, Upload, Download, Eye } from "lucide-react";
import { ExecutiveAuditReportCard } from "./ExecutiveAuditReportCard";
import { parseAuditAnalysis, serializeAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

interface Props {
  onClose: () => void;
  candidateId: string;
  sessionId: string;
  rawText: string | null;
  candidateName?: string;
  targetRole?: string | null;
  onSaved: () => void;
  // Defaults to the original skarion-student-audit-bridge endpoint (used by
  // the Audit tab) when omitted, so existing callers are unaffected. The
  // Training Audit tab passes its own local-table save instead.
  onSave?: (rawText: string) => Promise<{ ok: boolean; error?: string }>;
  // PDF management is optional and only wired up by the Training Audit tab —
  // the other Audit tab (spare-PC bridge) has no per-session PDF concept.
  pdfUrl?: string | null;
  pdfFilename?: string | null;
  onUploadPdf?: (file: File) => Promise<{ ok: boolean; error?: string }>;
  onDeletePdf?: () => Promise<{ ok: boolean; error?: string }>;
}

async function defaultSave(candidateId: string, sessionId: string, rawText: string) {
  const res = await fetch(`/api/candidates/${candidateId}/audit/mock-sessions/${sessionId}/analysis`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_analysis_text: rawText }),
  });
  if (!res.ok) return { ok: false, error: (await res.text()) || "Failed to save analysis" };
  return { ok: true };
}

type EditMode = "none" | "scores" | "raw";

export function ExecutiveAuditReportModal({
  onClose, candidateId, sessionId, rawText, candidateName, targetRole, onSaved, onSave,
  pdfUrl, pdfFilename, onUploadPdf, onDeletePdf,
}: Props) {
  const [mode, setMode] = useState<EditMode>(rawText ? "none" : "scores");
  const [draft, setDraft] = useState(rawText || "");
  const [scoresDraft, setScoresDraft] = useState(() => parseAuditAnalysis(rawText || ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfActionError, setPdfActionError] = useState("");

  async function saveRawText(text: string) {
    setSaving(true);
    setError("");
    try {
      const result = await (onSave ? onSave(text) : defaultSave(candidateId, sessionId, text));
      if (!result.ok) {
        setError(result.error || "Failed to save analysis");
        return;
      }
      setMode("none");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function openScoresEditor() {
    setScoresDraft(parseAuditAnalysis(rawText || ""));
    setMode("scores");
  }

  async function saveScores() {
    if (!scoresDraft) return;
    await saveRawText(serializeAuditAnalysis(scoresDraft));
  }

  async function handlePdfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUploadPdf) return;
    setPdfActionError("");
    setUploadingPdf(true);
    try {
      const result = await onUploadPdf(file);
      if (!result.ok) setPdfActionError(result.error || "Failed to upload PDF");
    } finally {
      setUploadingPdf(false);
    }
  }

  async function handleDeletePdf() {
    if (!onDeletePdf) return;
    if (!confirm("Remove the attached PDF evaluation sheet?")) return;
    setPdfActionError("");
    const result = await onDeletePdf();
    if (!result.ok) setPdfActionError(result.error || "Failed to remove PDF");
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Executive Audit Report</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {mode === "none" && rawText && (
              <button className="btn-primary" onClick={openScoresEditor}>
                <SlidersHorizontal size={14} /> Edit Scores
              </button>
            )}
            {mode === "none" && (
              <button className="btn-compact" onClick={() => { setDraft(rawText || ""); setMode("raw"); }}>
                <Edit3 size={14} /> Edit raw analysis
              </button>
            )}
            {mode !== "none" && (
              <button className="btn-compact" onClick={() => setMode("none")}>Cancel</button>
            )}
            <button className="btn-compact" onClick={onClose}>
              <X size={14} /> Close
            </button>
          </div>
        </div>

        {mode === "raw" && (
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
              <button className="btn-primary" onClick={() => saveRawText(draft)} disabled={saving || !draft.trim()}>
                <Save size={14} /> {saving ? "Saving..." : "Save & parse"}
              </button>
            </div>
          </div>
        )}

        {mode === "scores" && scoresDraft && (
          <div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Editing scores updates the underlying analysis text automatically — everything else (strengths, weaknesses, action items) is preserved as-is.
            </p>
            <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "0.9rem 1.15rem" }}>
              <label style={{ fontWeight: 800, fontSize: 14 }}>Overall Rating</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number" min={0} max={10} step={0.5}
                  className="input" style={{ width: 90, fontWeight: 800, textAlign: "center" }}
                  value={scoresDraft.overallScore ?? 0}
                  onChange={(e) => setScoresDraft({ ...scoresDraft, overallScore: Number(e.target.value) })}
                />
                <span className="muted">/ 10</span>
              </div>
            </div>

            {scoresDraft.metrics.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>Performance Evaluation Metrics</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                  {scoresDraft.metrics.map((metric, idx) => (
                    <div key={idx} className="card" style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <strong style={{ fontSize: 13 }}>{metric.name}</strong>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="number" min={0} max={metric.maxScore} step={0.5}
                            className="input" style={{ width: 70, textAlign: "center" }}
                            value={metric.score ?? 0}
                            onChange={(e) => {
                              const next = [...scoresDraft.metrics];
                              next[idx] = { ...metric, score: Number(e.target.value) };
                              setScoresDraft({ ...scoresDraft, metrics: next });
                            }}
                          />
                          <span className="muted" style={{ fontSize: 12 }}>/ {metric.maxScore}</span>
                        </div>
                      </div>
                      {metric.note && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{metric.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-primary" onClick={saveScores} disabled={saving}>
                <Save size={14} /> {saving ? "Saving..." : "Save Scores"}
              </button>
            </div>
          </div>
        )}

        {mode === "none" && <ExecutiveAuditReportCard rawText={rawText} candidateName={candidateName} targetRole={targetRole} />}

        {(onUploadPdf || pdfUrl) && (
          <div className="card" style={{ marginTop: 16, padding: "1rem 1.15rem" }}>
            <h4 style={{ fontSize: 14, marginTop: 0, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Paperclip size={14} /> Official PDF Evaluation Attachment
            </h4>
            {pdfUrl ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 13 }}>{pdfFilename || "evaluation.pdf"}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn-compact btn-sm" style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
                    <Eye size={13} /> Preview
                  </a>
                  <a href={pdfUrl} download={pdfFilename || true} target="_blank" rel="noreferrer" className="btn-compact btn-sm" style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
                    <Download size={13} /> Download
                  </a>
                  {onUploadPdf && (
                    <label className="btn-compact btn-sm" style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <Upload size={13} /> {uploadingPdf ? "Uploading…" : "Replace"}
                      <input type="file" accept="application/pdf,.pdf" onChange={handlePdfFile} disabled={uploadingPdf} style={{ display: "none" }} />
                    </label>
                  )}
                  {onDeletePdf && (
                    <button className="btn-compact btn-sm" onClick={handleDeletePdf} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              onUploadPdf && (
                <label className="btn-compact" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <Upload size={14} /> {uploadingPdf ? "Uploading…" : "Attach PDF Evaluation Sheet"}
                  <input type="file" accept="application/pdf,.pdf" onChange={handlePdfFile} disabled={uploadingPdf} style={{ display: "none" }} />
                </label>
              )
            )}
            {pdfActionError && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{pdfActionError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
