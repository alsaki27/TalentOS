"use client";
import { useEffect, useState } from "react";
import { ExecutiveAuditReportCard } from "@/components/audit/ExecutiveAuditReportCard";
import { ExecutiveAuditReportModal } from "@/components/audit/ExecutiveAuditReportModal";

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

interface MockSession {
  id: string;
  session_date: string;
  target_role: string | null;
  overall_score: number | null;
  overall_score_max: number | null;
  raw_analysis_text: string | null;
}

interface TrainingAuditSummary {
  linked: boolean;
  staleLink?: boolean;
  student: AuditStudent | null;
  stickyNotes: StickyNote[];
  mockSessions: MockSession[];
  syncedAt?: string;
}

const RATING_CONFIG: Record<string, string> = {
  placed: "Placed",
  excellent: "Excellent",
  good: "Good",
  needs_attention: "Needs Attention",
  bad: "At Risk",
};

export function TrainingAuditPanel({ candidateId }: { candidateId: string }) {
  const [summary, setSummary] = useState<TrainingAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuditStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ domain: "", progress: 0, rating: "good", placement_company: "", placement_role: "", placement_date: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [showNewSession, setShowNewSession] = useState(false);
  const [newSession, setNewSession] = useState({ session_date: new Date().toISOString().slice(0, 10), target_role: "", transcript_source: "teams", transcript_raw_text: "", analysis_raw_text: "" });
  const [creatingSession, setCreatingSession] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [modalSessionId, setModalSessionId] = useState<string | null>(null);

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
        if (!res.ok) {
          setSearchResults([]);
          setSearchError(true);
          return;
        }
        const data = await res.json();
        setSearchResults(data.results ?? []);
        setSearchError(false);
      } catch {
        setSearchResults([]);
        setSearchError(true);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  async function linkTo(studentId: string) {
    setLinking(studentId);
    const matched = searchResults.find((s) => s.id === studentId);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditStudentId: studentId }),
      });
      if (res.ok) {
        setSearchQuery("");
        setSearchResults([]);
        if (matched) setSummary({ linked: true, student: matched, stickyNotes: [], mockSessions: [] });
        void load();
      }
    } finally {
      setLinking(null);
    }
  }

  async function unlink() {
    if (!confirm("Unlink this candidate from the student-audit record? This does not delete any student-audit data.")) return;
    const previous = summary;
    setSummary({ linked: false, student: null, stickyNotes: [], mockSessions: [] });
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/link`, { method: "DELETE" });
      if (!res.ok) {
        setSummary(previous);
        return;
      }
      void load();
    } catch {
      setSummary(previous);
    }
  }

  function openEdit() {
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
  }

  async function saveEdit() {
    if (!summary?.student) return;
    setSavingEdit(true);
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
        return;
      }
      setShowEdit(false);
      void load();
    } catch {
      setSummary(previous);
    } finally {
      setSavingEdit(false);
    }
  }

  async function addNote() {
    const trimmed = noteContent.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, category: "General" }),
      });
      if (res.ok) {
        setNoteContent("");
        await load();
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function togglePin(note: StickyNote) {
    if (!summary) return;
    const previous = summary;
    setSummary({ ...summary, stickyNotes: summary.stickyNotes.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    if (!res.ok) setSummary(previous);
  }

  async function deleteNote(noteId: string) {
    if (!summary) return;
    const previous = summary;
    setSummary({ ...summary, stickyNotes: summary.stickyNotes.filter((n) => n.id !== noteId) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/sticky-notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) setSummary(previous);
  }

  async function createSession() {
    if (!newSession.transcript_raw_text.trim() && !newSession.analysis_raw_text.trim()) return;
    setCreatingSession(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSession),
      });
      if (res.ok) {
        setShowNewSession(false);
        setNewSession({ session_date: new Date().toISOString().slice(0, 10), target_role: "", transcript_source: "teams", transcript_raw_text: "", analysis_raw_text: "" });
        await load();
      }
    } finally {
      setCreatingSession(false);
    }
  }

  async function deleteSession(sessionId: string) {
    if (!confirm("Delete this mock interview session? This cannot be undone.")) return;
    if (!summary) return;
    const previous = summary;
    setSummary({ ...summary, mockSessions: summary.mockSessions.filter((s) => s.id !== sessionId) });
    const res = await fetch(`/api/candidates/${candidateId}/student-audit/mock-sessions/${sessionId}`, { method: "DELETE" });
    if (!res.ok) setSummary(previous);
    else void load();
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

  if (loadError) {
    return (
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>Couldn&apos;t load training audit data</strong></p>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Something went wrong loading this. Try again.</p>
        <button className="btn-compact btn-sm" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!summary?.linked || !summary.student) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ borderStyle: "dashed" }}>
          <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>No student-audit record linked</strong></p>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
            {summary?.staleLink
              ? "The previous link points at a record that no longer exists — search and link again."
              : "Search the Skarion Student Audit roster by name and link the matching record. Names and emails don't line up automatically between the two systems, so pick carefully."}
          </p>
          <input
            className="input"
            placeholder="Search student-audit roster by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: 360 }}
          />
        </div>

        {searching && <p className="muted" style={{ fontSize: 13 }}>Searching…</p>}
        {searchError && <p style={{ color: "var(--danger)", fontSize: 13 }}>Search failed — try again.</p>}

        {searchResults.length > 0 && (
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td className="muted">{s.domain ?? s.target_role ?? "—"}</td>
                    <td><span className="badge">{RATING_CONFIG[s.rating] ?? s.rating}</span></td>
                    <td>
                      <button className="btn-compact btn-sm" onClick={() => linkTo(s.id)} disabled={linking === s.id}>
                        {linking === s.id ? "Linking…" : "Link"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const { student, stickyNotes, mockSessions, syncedAt } = summary;
  const openSession = mockSessions.find((s) => s.id === openSessionId) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <h2 style={{ fontSize: 16, margin: 0 }}>Training &amp; mock interview audit</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{RATING_CONFIG[student.rating] ?? student.rating}</span>
          <button className="btn-compact btn-sm" onClick={openEdit}>Edit</button>
          <button className="btn-compact btn-sm" onClick={unlink}>Unlink</button>
        </div>
      </div>
      {syncedAt && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Imported from Skarion Student Audit on {new Date(syncedAt).toLocaleDateString()} — edited directly in TalentOS from here on.
        </p>
      )}

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div><label>Course progress</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.progress}%</p></div>
        <div><label>Mock interviews</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.mock_interviews}</p></div>
        <div><label>Domain / track</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.domain ?? student.target_role ?? "—"}</p></div>
        <div><label>Joined</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.joining_date ? new Date(student.joining_date).toLocaleDateString() : "—"}</p></div>
        {student.placement_company && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Placed</label>
            <p style={{ margin: "2px 0 0" }}>
              {student.placement_role} at {student.placement_company}
              {student.placement_date ? ` · ${new Date(student.placement_date).toLocaleDateString()}` : ""}
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Mock interview sessions ({mockSessions.length})</h3>
          <button className="btn-compact btn-sm" onClick={() => setShowNewSession(!showNewSession)}>
            {showNewSession ? "Cancel" : "+ New mock session"}
          </button>
        </div>

        {showNewSession && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="date" value={newSession.session_date} onChange={(e) => setNewSession({ ...newSession, session_date: e.target.value })} style={{ maxWidth: 160 }} />
              <input className="input" placeholder="Target role" value={newSession.target_role} onChange={(e) => setNewSession({ ...newSession, target_role: e.target.value })} />
              <select className="input" style={{ maxWidth: 140 }} value={newSession.transcript_source} onChange={(e) => setNewSession({ ...newSession, transcript_source: e.target.value })}>
                <option value="teams">Teams</option>
                <option value="zoom">Zoom</option>
                <option value="meet">Meet</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Paste raw transcript (optional — auto-organized)</label>
              <textarea className="input" rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={newSession.transcript_raw_text} onChange={(e) => setNewSession({ ...newSession, transcript_raw_text: e.target.value })} placeholder={"Mayukh   0:03\nLet's get started..."} />
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Paste audit analysis text (optional — parsed automatically)</label>
              <textarea className="input" rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={newSession.analysis_raw_text} onChange={(e) => setNewSession({ ...newSession, analysis_raw_text: e.target.value })} placeholder={"Overall Assessment: 8.5 / 10 (...)\n\nPERFORMANCE METRICS:\n* Communication & Delivery: 9 / 10 (...)"} />
            </div>
            <button className="btn-primary" onClick={createSession} disabled={creatingSession}>
              {creatingSession ? "Saving..." : "Save session"}
            </button>
          </div>
        )}

        {mockSessions.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No mock interviews recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mockSessions.map((s) => (
              <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setOpenSessionId(openSessionId === s.id ? null : s.id)}>
                    <strong style={{ fontSize: 13 }}>{new Date(s.session_date).toLocaleDateString()}</strong>
                    {s.target_role && <span className="muted" style={{ fontSize: 12 }}>{s.target_role}</span>}
                    {s.overall_score !== null && <span className="badge badge-info">{s.overall_score}/{s.overall_score_max ?? 10}</span>}
                  </div>
                  <button className="btn-compact btn-sm" onClick={() => deleteSession(s.id)}>Delete</button>
                </div>
                {openSessionId === s.id && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <ExecutiveAuditReportCard rawText={s.raw_analysis_text} candidateName={student.name} targetRole={s.target_role} onOpenModal={() => setModalSessionId(s.id)} />
                    {!s.raw_analysis_text && (
                      <button className="btn-compact btn-sm" onClick={() => setModalSessionId(s.id)}>+ Add audit analysis</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalSessionId && (
        <ExecutiveAuditReportModal
          candidateId={candidateId}
          sessionId={modalSessionId}
          rawText={mockSessions.find((s) => s.id === modalSessionId)?.raw_analysis_text ?? null}
          candidateName={student.name}
          targetRole={openSession?.target_role}
          onSave={(rawText) => saveSessionAnalysis(modalSessionId, rawText)}
          onClose={() => setModalSessionId(null)}
          onSaved={async () => {
            setModalSessionId(null);
            await load();
          }}
        />
      )}

      <div className="card">
        <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>Sticky notes ({stickyNotes.length})</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input type="text" className="input" placeholder="Add a note..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} style={{ flex: 1 }} />
          <button className="btn-compact" onClick={addNote} disabled={savingNote}>Add</button>
        </div>
        {stickyNotes.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No notes yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stickyNotes.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: 11 }}>{n.author} · {n.date} · {n.category}</span>
                  <div style={{ display: "flex", gap: 8 }}>
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

      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit training audit — {student.name}</h2>
            <div className="field-group">
              <label>Domain / track</label>
              <input className="input" value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} />
            </div>
            <div className="field-group">
              <label>Course progress ({editForm.progress}%)</label>
              <input type="range" min={0} max={100} value={editForm.progress} onChange={(e) => setEditForm({ ...editForm, progress: Number(e.target.value) })} style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label>Rating / status</label>
              <select className="input" value={editForm.rating} onChange={(e) => setEditForm({ ...editForm, rating: e.target.value })}>
                {Object.entries(RATING_CONFIG).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
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
