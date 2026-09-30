"use client";
import { useEffect, useState } from "react";
import { BookOpen, Award, FileText, Edit3, Send, Link2, BarChart2, BookMarked, Trash2, Paperclip } from "lucide-react";
import { ExecutiveAuditReportModal } from "@/components/audit/ExecutiveAuditReportModal";
import { MockSessionForm, getScoreColor, type MockSessionData } from "@/components/candidates/MockSessionForm";
import { TranscriptModal } from "@/components/candidates/TranscriptModal";

interface AuditStudent {
  id: string;
  name: string;
  domain: string | null;
  target_role: string | null;
  joining_date: string | null;
  progress: number;
  mock_interviews: number;
  rating: string;
  placement_company: string | null;
  placement_role: string | null;
  placement_date: string | null;
}

interface StickyNote {
  id: string;
  date: string;
  content: string;
  category: string;
  author: string;
  accent: string;
  pinned: boolean;
}

interface TrainingAuditSummary {
  linked: boolean;
  student: AuditStudent | null;
  stickyNotes: StickyNote[];
  mockSessions: MockSessionData[];
  syncedAt?: string;
}

const RATING_CONFIG: Record<string, { label: string; color: string }> = {
  placed: { label: "Placed", color: "#8b5cf6" },
  excellent: { label: "Excellent", color: "#059669" },
  good: { label: "Good", color: "#0284c7" },
  needs_attention: { label: "Needs Attention", color: "#d97706" },
  bad: { label: "At Risk", color: "#dc2626" },
};

const EVALUATORS = ["Mayukh", "Kasshaf", "Faisal", "Saki", "Ferdous", "Piyas"];
const CATEGORIES = [
  "General", "Mock Feedback", "Technical", "Soft Skills", "Attendance",
  "Onboarding", "Interview Experience", "Course Progression", "Behavior", "Background", "Situation",
];

function StatCard({ icon, label, value, valueColor, subtitle, progress }: {
  icon: React.ReactNode; label: string; value: string; valueColor: string; subtitle: string; progress?: number;
}) {
  return (
    <div className="card" style={{ padding: "1rem 1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
        <span style={{ color: valueColor, opacity: 0.8 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: valueColor, lineHeight: 1.1 }}>{value}</div>
      {progress !== undefined ? (
        <div style={{ height: 6, background: "var(--border)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: valueColor, borderRadius: 999 }} />
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{subtitle}</p>
      )}
    </div>
  );
}

export function TrainingAuditPanel({ candidateId }: { candidateId: string }) {
  const [summary, setSummary] = useState<TrainingAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showMerge, setShowMerge] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuditStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ domain: "", progress: 0, rating: "good", placement_company: "", placement_role: "", placement_date: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [existingDomains, setExistingDomains] = useState<string[]>([]);

  const [logForm, setLogForm] = useState({ author: EVALUATORS[0], category: "General", date: new Date().toISOString().slice(0, 10), content: "" });
  const [savingNote, setSavingNote] = useState(false);

  const [showNewSession, setShowNewSession] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [modalSessionId, setModalSessionId] = useState<string | null>(null);
  const [transcriptSessionId, setTranscriptSessionId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit`, { cache: "no-store" });
      if (!res.ok) {
        setSummary(null);
        setLoadError(true);
        return;
      }
      setSummary(await res.json());
    } catch {
      setSummary(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [candidateId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/student-audit/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = res.ok ? await res.json() : { results: [] };
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  async function linkTo(studentId: string) {
    setLinking(studentId);
    setActionError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditStudentId: studentId }),
      });
      if (res.ok) {
        setSearchQuery("");
        setSearchResults([]);
        setShowMerge(false);
        void load();
      } else {
        setActionError((await res.json().catch(() => ({})))?.error || "Failed to link this record.");
      }
    } catch {
      setActionError("Failed to link this record.");
    } finally {
      setLinking(null);
    }
  }

  async function openEdit() {
    if (!summary?.student) return;
    const s = summary.student;
    setEditForm({
      domain: s.domain ?? s.target_role ?? "",
      progress: s.progress,
      rating: s.rating,
      placement_company: s.placement_company ?? "",
      placement_role: s.placement_role ?? "",
      placement_date: s.placement_date ?? "",
    });
    setShowEdit(true);
    try {
      const res = await fetch("/api/student-audit/domains", { cache: "no-store" });
      if (res.ok) setExistingDomains((await res.json()).domains ?? []);
    } catch {
      /* quick-assign list is a convenience, not required */
    }
  }

  async function saveEdit() {
    if (!summary?.student) return;
    setSavingEdit(true);
    setActionError(null);
    const previous = summary;
    const optimisticStudent: AuditStudent = {
      ...summary.student,
      domain: editForm.domain,
      target_role: editForm.domain,
      progress: Number(editForm.progress),
      rating: editForm.rating,
      placement_company: editForm.rating === "placed" ? editForm.placement_company : null,
      placement_role: editForm.rating === "placed" ? editForm.placement_role : null,
      placement_date: editForm.rating === "placed" ? (editForm.placement_date || new Date().toISOString().slice(0, 10)) : null,
    };
    setSummary({ ...summary, student: optimisticStudent });
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: optimisticStudent.domain,
          target_role: optimisticStudent.target_role,
          progress: optimisticStudent.progress,
          rating: optimisticStudent.rating,
          placement_company: optimisticStudent.placement_company,
          placement_role: optimisticStudent.placement_role,
          placement_date: optimisticStudent.placement_date,
        }),
      });
      if (!res.ok) {
        setSummary(previous);
        setActionError((await res.json().catch(() => ({})))?.error || "Failed to save changes.");
        return;
      }
      setShowEdit(false);
      void load();
    } catch {
      setSummary(previous);
      setActionError("Failed to save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveLog() {
    const trimmed = logForm.content.trim();
    if (!trimmed) return;
    setSavingNote(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, category: logForm.category, author: logForm.author, date: logForm.date }),
      });
      if (res.ok) {
        setLogForm({ ...logForm, content: "" });
        await load();
      } else {
        setActionError((await res.json().catch(() => ({})))?.error || "Failed to save the log entry.");
      }
    } catch {
      setActionError("Failed to save the log entry.");
    } finally {
      setSavingNote(false);
    }
  }

  async function togglePin(note: StickyNote) {
    if (!summary) return;
    setActionError(null);
    const previous = summary;
    setSummary({ ...summary, stickyNotes: summary.stickyNotes.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    if (!res.ok) {
      setSummary(previous);
      setActionError("Failed to update the pin.");
    }
  }

  async function deleteNote(noteId: string) {
    if (!summary) return;
    setActionError(null);
    const previous = summary;
    setSummary({ ...summary, stickyNotes: summary.stickyNotes.filter((n) => n.id !== noteId) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
      setSummary(previous);
      setActionError("Failed to delete the entry.");
    }
  }

  async function deleteSession(sessionId: string) {
    if (!confirm("Delete this mock interview session? This cannot be undone.")) return;
    if (!summary) return;
    setActionError(null);
    const previous = summary;
    setSummary({ ...summary, mockSessions: summary.mockSessions.filter((s) => s.id !== sessionId) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      setSummary(previous);
      setActionError("Failed to delete the session.");
    } else {
      void load();
    }
  }

  async function saveSessionAnalysis(sessionId: string, rawText: string) {
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${sessionId}/analysis`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_analysis_text: rawText }),
    });
    if (!res.ok) return { ok: false, error: (await res.text()) || "Failed to save analysis" };
    return { ok: true };
  }

  if (loading) return <p className="muted">Loading training audit…</p>;

  if (loadError || !summary?.student) {
    return (
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>Couldn&apos;t load training audit data</strong></p>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Something went wrong loading this. Try again.</p>
        <button className="btn-compact btn-sm" onClick={load}>Retry</button>
      </div>
    );
  }

  const { student, stickyNotes, mockSessions, syncedAt } = summary;
  const ratingCfg = RATING_CONFIG[student.rating] ?? { label: student.rating, color: "#64748b" };
  const pinnedFirst = [...stickyNotes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const modalSession = mockSessions.find((s) => s.id === modalSessionId) || null;
  const editingSession = mockSessions.find((s) => s.id === editingSessionId) || null;
  const transcriptSession = mockSessions.find((s) => s.id === transcriptSessionId) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{student.name}</h2>
          <span className="badge" style={{ color: ratingCfg.color, borderColor: ratingCfg.color }}>{ratingCfg.label}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-primary" onClick={openEdit} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Edit3 size={14} /> Edit Record
          </button>
          <button className="btn-compact btn-sm" onClick={() => setShowMerge(!showMerge)} title="Merge this candidate into an existing historical Skarion Student Audit record">
            <Link2 size={12} /> Merge record
          </button>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error" style={{ margin: 0 }}>
          {actionError}
          <button className="alert-close" onClick={() => setActionError(null)}>&times;</button>
        </div>
      )}

      {syncedAt && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Imported from Skarion Student Audit on {new Date(syncedAt).toLocaleDateString()} — edited directly in TalentOS from here on.
        </p>
      )}

      {showMerge && (
        <div className="card">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Search the historical Skarion Student Audit roster and link this candidate to a matching record — useful if this candidate has older
            mentorship history under a slightly different name. Names/emails don&apos;t line up automatically, so pick carefully.
          </p>
          <input
            className="input"
            placeholder="Search by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          {searching && <p className="muted" style={{ fontSize: 13 }}>Searching…</p>}
          {searchResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {searchResults.map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
                  <span style={{ fontSize: 13 }}><strong>{s.name}</strong> <span className="muted">— {s.domain ?? s.target_role ?? "—"}</span></span>
                  <button className="btn-compact btn-sm" onClick={() => linkTo(s.id)} disabled={linking === s.id}>
                    {linking === s.id ? "Linking…" : "Link"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatCard icon={<BookOpen size={18} />} label="Course Completion" value={`${student.progress}%`} valueColor="#0284c7" subtitle="" progress={student.progress} />
        <StatCard icon={<Award size={18} />} label="Mock Interviews" value={`${student.mock_interviews} Session${student.mock_interviews === 1 ? "" : "s"}`} valueColor="#dc2626" subtitle="Attended tech evaluations" />
        <StatCard icon={<FileText size={18} />} label="Audit Log Entries" value={`${stickyNotes.length} Record${stickyNotes.length === 1 ? "" : "s"}`} valueColor="#0284c7" subtitle="Historical mentor observation trail" />
      </div>

      {(student.domain || student.joining_date || student.placement_company) && (
        <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div><label>Domain / track</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.domain ?? student.target_role ?? "—"}</p></div>
          <div><label>Joined</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.joining_date ? new Date(student.joining_date).toLocaleDateString() : "—"}</p></div>
          {student.placement_company && (
            <div>
              <label>Placed</label>
              <p style={{ margin: "2px 0 0" }}>
                {student.placement_role} at {student.placement_company}
                {student.placement_date ? ` · ${new Date(student.placement_date).toLocaleDateString()}` : ""}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12, color: "var(--primary)" }}>Add Candidate Observation Record</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 12 }}>Evaluator</label>
            <select className="input" value={logForm.author} onChange={(e) => setLogForm({ ...logForm, author: e.target.value })}>
              {EVALUATORS.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12 }}>Category</label>
            <select className="input" value={logForm.category} onChange={(e) => setLogForm({ ...logForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12 }}>Observation Date</label>
            <input className="input" type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="input"
            placeholder="Record candidate observation, mock interview feedback or attendance alert…"
            value={logForm.content}
            onChange={(e) => setLogForm({ ...logForm, content: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") saveLog(); }}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={saveLog} disabled={savingNote || !logForm.content.trim()} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <Send size={14} /> {savingNote ? "Saving…" : "Save Log"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Candidate Audit Log Trail</h3>
          <span className="muted" style={{ fontSize: 12 }}>{stickyNotes.length} Total Entries</span>
        </div>
        {pinnedFirst.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No audit logs recorded for this candidate yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pinnedFirst.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: 11 }}>{n.author} · {n.date} · {n.category}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {n.pinned && <span className="badge badge-info" style={{ fontSize: 10 }}>Pinned</span>}
                    <button className="btn-compact btn-sm" onClick={() => togglePin(n)}>{n.pinned ? "Unpin" : "Pin"}</button>
                    <button className="btn-compact btn-sm" onClick={() => deleteNote(n.id)}>Delete</button>
                  </div>
                </div>
                <p style={{ margin: "6px 0 0" }}>{n.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Mock interview sessions ({mockSessions.length})</h3>
          <button className="btn-compact btn-sm" onClick={() => { setShowNewSession(!showNewSession); setEditingSessionId(null); }}>
            {showNewSession ? "Cancel" : "+ Log Mock Interview"}
          </button>
        </div>

        {showNewSession && (
          <MockSessionForm
            candidateId={candidateId}
            onCancel={() => setShowNewSession(false)}
            onSaved={() => { setShowNewSession(false); void load(); }}
          />
        )}

        {mockSessions.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No mock interviews recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mockSessions.map((s) => {
              if (editingSessionId === s.id) {
                return (
                  <MockSessionForm
                    key={s.id}
                    candidateId={candidateId}
                    initial={s}
                    onCancel={() => setEditingSessionId(null)}
                    onSaved={() => { setEditingSessionId(null); void load(); }}
                  />
                );
              }
              const hasTranscript = !!s.transcript_raw_text?.trim();
              const wordCount = hasTranscript ? s.transcript_raw_text!.trim().split(/\s+/).filter(Boolean).length : 0;
              const scoreColor = getScoreColor(s.overall_score);
              const analysisLabel = s.pdf_url ? "Audit + PDF" : s.raw_analysis_text ? "Audit Report" : "+ Analysis";
              return (
                <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {s.overall_score !== null && (
                        <span style={{ background: `${scoreColor}20`, color: scoreColor, fontWeight: 800, fontSize: 13, padding: "2px 8px", borderRadius: 6, border: `1px solid ${scoreColor}40` }}>
                          {s.overall_score} / {s.overall_score_max ?? 10}
                        </span>
                      )}
                      {s.created_by && <span className="badge">{s.created_by}</span>}
                      {s.round_type && <span className="badge">{s.round_type}</span>}
                      <span className="muted" style={{ fontSize: 12 }}>{new Date(s.session_date).toLocaleDateString()}</span>
                    </div>
                    <button className="btn-compact btn-sm" onClick={() => deleteSession(s.id)}><Trash2 size={12} /></button>
                  </div>
                  {s.feedback_summary && <p style={{ margin: "8px 0 0", fontSize: 13, fontStyle: "italic" }}>&quot;{s.feedback_summary}&quot;</p>}
                  {(s.strengths_noted || s.areas_for_improvement) && (
                    <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                      {s.strengths_noted && <>Strengths: {s.strengths_noted}. </>}
                      {s.areas_for_improvement && <>Improve: {s.areas_for_improvement}.</>}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="btn-compact btn-sm" onClick={() => setModalSessionId(s.id)} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <BarChart2 size={12} /> {analysisLabel}
                    </button>
                    <button className="btn-compact btn-sm" onClick={() => setTranscriptSessionId(s.id)} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <BookMarked size={12} /> {hasTranscript ? `Transcript (${wordCount}w)` : "+ Add Transcript"}
                    </button>
                    <button className="btn-compact btn-sm" onClick={() => { setEditingSessionId(s.id); setShowNewSession(false); }} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Edit3 size={12} /> Edit
                    </button>
                    {s.pdf_url && (
                      <a href={s.pdf_url} target="_blank" rel="noreferrer" className="btn-compact btn-sm" style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
                        <Paperclip size={12} /> {s.pdf_filename || "View PDF"}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalSessionId && modalSession && (
        <ExecutiveAuditReportModal
          candidateId={candidateId}
          sessionId={modalSessionId}
          rawText={modalSession.raw_analysis_text}
          candidateName={student.name}
          targetRole={modalSession.round_type}
          onSave={(rawText) => saveSessionAnalysis(modalSessionId, rawText)}
          onClose={() => setModalSessionId(null)}
          onSaved={async () => {
            setModalSessionId(null);
            await load();
          }}
        />
      )}

      {transcriptSessionId && transcriptSession && (
        <TranscriptModal
          candidateId={candidateId}
          session={transcriptSession}
          candidateName={student.name}
          onClose={() => setTranscriptSessionId(null)}
          onSaved={async () => {
            setTranscriptSessionId(null);
            await load();
          }}
        />
      )}

      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit training audit — {student.name}</h2>
            <div className="field-group">
              <label>Domain / track</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" style={{ flex: 1 }} value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} placeholder="Type a custom domain…" />
                {existingDomains.length > 0 && (
                  <select
                    className="input"
                    style={{ maxWidth: 220 }}
                    value=""
                    onChange={(e) => { if (e.target.value) setEditForm({ ...editForm, domain: e.target.value }); }}
                    title="Pick an existing domain to merge into the same track"
                  >
                    <option value="">-- Quick Assign Existing --</option>
                    {existingDomains.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
              </div>
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Type a custom domain name or pick from existing recorded domains to merge candidates into identical tracks.
              </p>
            </div>
            <div className="field-group">
              <label>Course progress ({editForm.progress}%)</label>
              <input type="range" min={0} max={100} value={editForm.progress} onChange={(e) => setEditForm({ ...editForm, progress: Number(e.target.value) })} style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label>Rating / status</label>
              <select className="input" value={editForm.rating} onChange={(e) => setEditForm({ ...editForm, rating: e.target.value })}>
                {Object.entries(RATING_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            {editForm.rating === "placed" && (
              <>
                <div className="field-group">
                  <label>Placement company</label>
                  <input className="input" value={editForm.placement_company} onChange={(e) => setEditForm({ ...editForm, placement_company: e.target.value })} />
                </div>
                <div className="field-group">
                  <label>Placement role</label>
                  <input className="input" value={editForm.placement_role} onChange={(e) => setEditForm({ ...editForm, placement_role: e.target.value })} />
                </div>
                <div className="field-group">
                  <label>Placement date</label>
                  <input className="input" type="date" value={editForm.placement_date} onChange={(e) => setEditForm({ ...editForm, placement_date: e.target.value })} />
                </div>
              </>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowEdit(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
