"use client";
import { useState } from "react";
import { Send, Save, Trash2, BarChart2, FileText, Paperclip } from "lucide-react";

// Ported verbatim from skarion-student-audit's src/data/initialData.js
export const EVALUATORS = ["Mayukh", "Kasshaf", "Faisal", "Saki", "Ferdous", "Piyas"];
export const MOCK_ROUND_TYPES = ["Behavioral", "Practical", "Technological", "Overall", "Other"];

export function getScoreColor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 8) return "#059669";
  if (s >= 5) return "#0284c7";
  return "#dc2626";
}

export interface MockSessionData {
  id: string;
  session_date: string;
  round_type: string | null;
  overall_score: number | null;
  overall_score_max: number | null;
  feedback_summary: string | null;
  strengths_noted: string | null;
  areas_for_improvement: string | null;
  transcript_raw_text: string | null;
  raw_analysis_text: string | null;
  pdf_url: string | null;
  pdf_filename: string | null;
  created_by: string | null;
}

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export function MockSessionForm({
  candidateId,
  initial,
  onCancel,
  onSaved,
}: {
  candidateId: string;
  initial?: MockSessionData | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.session_date ?? new Date().toISOString().slice(0, 10));
  const [evaluator, setEvaluator] = useState(initial?.created_by ?? EVALUATORS[0]);
  const [roundType, setRoundType] = useState(initial?.round_type ?? MOCK_ROUND_TYPES[0]);
  const [score, setScore] = useState(initial?.overall_score ?? 7.5);
  const [feedback, setFeedback] = useState(initial?.feedback_summary ?? "");
  const [strengths, setStrengths] = useState(initial?.strengths_noted ?? "");
  const [improvement, setImprovement] = useState(initial?.areas_for_improvement ?? "");
  const [analysisText, setAnalysisText] = useState(initial?.raw_analysis_text ?? "");
  const [transcriptText, setTranscriptText] = useState(initial?.transcript_raw_text ?? "");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [existingPdfName, setExistingPdfName] = useState(initial?.pdf_filename ?? null);
  const [saving, setSaving] = useState(false);
  const [removingPdf, setRemovingPdf] = useState(false);
  const [error, setError] = useState("");

  async function removePdf() {
    if (pdfFile) {
      // Never uploaded yet — just clear the local selection.
      setPdfFile(null);
      return;
    }
    if (!initial) return;
    setRemovingPdf(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${initial.id}/pdf`, { method: "DELETE" });
      if (res.ok) setExistingPdfName(null);
      else setError((await res.json().catch(() => ({})))?.error || "Failed to remove the PDF.");
    } finally {
      setRemovingPdf(false);
    }
  }

  function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPdfError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("Please select a valid PDF file (.pdf)");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setPdfError("File too large. Maximum PDF size is 15MB.");
      return;
    }
    setPdfFile(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        session_date: date,
        created_by: evaluator,
        round_type: roundType,
        overall_score: score,
        feedback_summary: feedback.trim(),
        strengths_noted: strengths.trim(),
        areas_for_improvement: improvement.trim(),
        analysis_raw_text: analysisText.trim(),
        transcript_raw_text: transcriptText.trim(),
      };

      const res = isEdit
        ? await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${initial!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error || "Failed to save the mock session.");
        return;
      }
      const data = await res.json();
      const sessionId: string = data.session?.id ?? initial?.id;

      if (pdfFile && sessionId) {
        const fd = new FormData();
        fd.append("file", pdfFile);
        const pdfRes = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${sessionId}/pdf`, {
          method: "POST",
          body: fd,
        });
        if (!pdfRes.ok) {
          setError((await pdfRes.json().catch(() => ({})))?.error || "Session saved, but the PDF failed to upload.");
          return;
        }
      }
      onSaved();
    } catch {
      setError("Failed to save the mock session — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <div>
          <label style={{ fontSize: 12 }}>Mock Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Interviewer / Evaluator</label>
          <select className="input" value={evaluator} onChange={(e) => setEvaluator(e.target.value)}>
            {EVALUATORS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Mock Round Type</label>
          <select className="input" value={roundType} onChange={(e) => setRoundType(e.target.value)}>
            {MOCK_ROUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background: "var(--bg)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Mock Rating Score (Out of 10)</label>
          <span style={{ fontSize: 16, fontWeight: 800, color: getScoreColor(score), background: `${getScoreColor(score)}20`, padding: "2px 10px", borderRadius: 8 }}>
            {score} / 10
          </span>
        </div>
        <input type="range" min={1} max={10} step={0.5} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: "100%", accentColor: getScoreColor(score) }} />
      </div>

      <div>
        <label style={{ fontSize: 12 }}>Detailed Performance Observation &amp; Summary Feedback *</label>
        <textarea className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Record interviewer observations, coding speed, communication, and technical depth..." required style={{ width: "100%" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 12 }}>Key Strengths Noted</label>
          <input className="input" value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder="e.g. Clean recursion, verbal communication" />
        </div>
        <div>
          <label style={{ fontSize: 12 }}>Areas for Improvement</label>
          <input className="input" value={improvement} onChange={(e) => setImprovement(e.target.value)} placeholder="e.g. Edge case testing, dynamic programming" />
        </div>
      </div>

      <div>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <BarChart2 size={13} /> Candidate Performance Metrics &amp; Audit Breakdown (Optional — auto-parsed)
        </label>
        <textarea className="input" rows={5} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={analysisText} onChange={(e) => setAnalysisText(e.target.value)}
          placeholder={"Overall Assessment: 8.5 / 10 (...)\n\nPERFORMANCE METRICS:\n* Communication & Delivery: 9 / 10 (...)"} />
      </div>

      <div>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <FileText size={13} /> Copy-Paste Full Mock Transcript (Teams / Zoom / Meet supported)
        </label>
        <textarea className="input" rows={4} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={transcriptText} onChange={(e) => setTranscriptText(e.target.value)}
          placeholder={"Mayukh   0:03\nLet's get started..."} />
      </div>

      <div>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Paperclip size={13} /> Attach Official PDF Evaluation Sheet / Document (Optional)</span>
          {(pdfFile || existingPdfName) && <span style={{ color: "#059669", fontSize: 11, fontWeight: 700 }}>✓ PDF Attached</span>}
        </label>
        {pdfFile || existingPdfName ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
            <span style={{ fontSize: 12 }}>{pdfFile?.name ?? existingPdfName}</span>
            <button type="button" className="btn-compact btn-sm" onClick={removePdf} disabled={removingPdf} title="Remove">
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <input type="file" accept="application/pdf,.pdf" className="input" onChange={handlePdfChange} />
        )}
        {pdfError && <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0" }}>{pdfError}</p>}
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn-compact" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isEdit ? <Save size={14} /> : <Send size={14} />} {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Mock Record"}
        </button>
      </div>
    </form>
  );
}
