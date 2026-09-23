"use client";
import { useEffect, useState } from "react";
import { AuditTicker } from "@/components/audit/AuditTicker";
import { AuditCalendar } from "@/components/audit/AuditCalendar";
import { ExecutiveAuditReportCard } from "@/components/audit/ExecutiveAuditReportCard";
import { ExecutiveAuditReportModal } from "@/components/audit/ExecutiveAuditReportModal";
import { fireCelebration } from "@/lib/audit/confetti";

interface AuditStudent {
  id: string;
  name: string;
  progress: number;
  mock_interviews: number;
  rating: string;
  placement_company: string;
  placement_role: string;
  domain: string | null;
  target_role: string | null;
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
  summary: string | null;
  raw_analysis_text: string | null;
}

interface CalendarEvent {
  id: string;
  event_date: string;
  title: string;
  event_type: string;
}

interface AuditSummary {
  linked: boolean;
  student: AuditStudent | null;
  stickyNotes: StickyNote[];
  mockSessions: MockSession[];
  calendarEvents: CalendarEvent[];
}

interface SessionDetail extends MockSession {
  transcripts: Array<{ id: string; source: string; lines: Array<{ speaker: string; is_candidate: boolean; text: string }> }>;
  report: {
    strengths: Array<{ title: string; description: string }>;
    weaknesses: string[];
    action_items: Array<{ title: string; action: string }>;
    metrics: Array<{ name?: string; label?: string; score?: number; max?: number }>;
  } | null;
}

export function AuditPanel({ candidateId }: { candidateId: string }) {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [modalSessionId, setModalSessionId] = useState<string | null>(null);

  const [showNewSession, setShowNewSession] = useState(false);
  const [newSession, setNewSession] = useState({ session_date: new Date().toISOString().slice(0, 10), target_role: "", transcript_source: "teams", transcript_raw_text: "", analysis_raw_text: "" });
  const [creatingSession, setCreatingSession] = useState(false);

  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ event_date: "", title: "", event_type: "meeting" });

  const [showPlacement, setShowPlacement] = useState(false);
  const [placement, setPlacement] = useState({ placement_company: "", placement_role: "" });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit`);
      if (res.ok) setSummary(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [candidateId]);

  async function startTracking() {
    setLinking(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit/link`, { method: "POST" });
      if (res.ok) await load();
    } finally {
      setLinking(false);
    }
  }

  async function addNote() {
    const trimmed = noteContent.trim();
    if (!trimmed) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit/sticky-notes`, {
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
    await fetch(`/api/candidates/${candidateId}/audit/sticky-notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    await load();
  }

  async function deleteNote(noteId: string) {
    await fetch(`/api/candidates/${candidateId}/audit/sticky-notes/${noteId}`, { method: "DELETE" });
    await load();
  }

  async function openSession(sessionId: string) {
    if (openSessionId === sessionId) {
      setOpenSessionId(null);
      setSessionDetail(null);
      return;
    }
    setOpenSessionId(sessionId);
    setSessionLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit/mock-sessions/${sessionId}`);
      if (res.ok) setSessionDetail(await res.json());
    } finally {
      setSessionLoading(false);
    }
  }

  async function createSession() {
    if (!newSession.transcript_raw_text.trim() && !newSession.analysis_raw_text.trim()) return;
    setCreatingSession(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/audit/mock-sessions`, {
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

  async function createEvent() {
    if (!newEvent.event_date || !newEvent.title.trim()) return;
    const res = await fetch(`/api/candidates/${candidateId}/audit/calendar-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEvent),
    });
    if (res.ok) {
      setShowNewEvent(false);
      setNewEvent({ event_date: "", title: "", event_type: "meeting" });
      await load();
    }
  }

  async function deleteEvent(eventId: string) {
    await fetch(`/api/candidates/${candidateId}/audit/calendar-events/${eventId}`, { method: "DELETE" });
    await load();
  }

  async function markPlaced() {
    if (!placement.placement_company.trim() || !placement.placement_role.trim()) return;
    const res = await fetch(`/api/candidates/${candidateId}/audit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...placement, placement_date: new Date().toISOString().slice(0, 10), rating: "placed" }),
    });
    if (res.ok) {
      setShowPlacement(false);
      fireCelebration();
      await load();
    }
  }

  if (loading) return <p className="muted">Loading audit history...</p>;

  if (!summary?.linked || !summary.student) {
    return (
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>No skarion-student-audit record linked</strong></p>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
          This candidate isn&apos;t tracked in the mentorship/mock-interview audit system yet.
        </p>
        <button className="btn-primary" onClick={startTracking} disabled={linking}>
          {linking ? "Starting..." : "+ Start tracking this candidate"}
        </button>
      </div>
    );
  }

  const { student, stickyNotes, mockSessions, calendarEvents } = summary;
  const avgScore = mockSessions.filter((s) => s.overall_score !== null).length
    ? (mockSessions.reduce((sum, s) => sum + (s.overall_score ?? 0), 0) / mockSessions.filter((s) => s.overall_score !== null).length).toFixed(1)
    : "—";
  const latestActionItems =
    sessionDetail?.report?.action_items ??
    [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AuditTicker stickyNotes={stickyNotes} latestActionItems={latestActionItems} />

      <div className="page-header">
        <h2 style={{ fontSize: 16, margin: 0 }}>Mentorship &amp; mock interview audit</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{student.rating}</span>
          {student.rating !== "placed" && (
            <button className="btn-compact btn-sm" onClick={() => setShowPlacement(true)}>Mark placed</button>
          )}
        </div>
      </div>

      {showPlacement && (
        <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" placeholder="Company" style={{ maxWidth: 220 }} value={placement.placement_company} onChange={(e) => setPlacement({ ...placement, placement_company: e.target.value })} />
          <input className="input" placeholder="Role" style={{ maxWidth: 220 }} value={placement.placement_role} onChange={(e) => setPlacement({ ...placement, placement_role: e.target.value })} />
          <button className="btn-primary btn-sm" onClick={markPlaced}>Confirm placement 🎉</button>
          <button className="btn-compact btn-sm" onClick={() => setShowPlacement(false)}>Cancel</button>
        </div>
      )}

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div><label>Progress</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.progress}%</p></div>
        <div><label>Mock interviews</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.mock_interviews}</p></div>
        <div><label>Avg audit score</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{avgScore}{avgScore !== "—" && " / 10"}</p></div>
        <div><label>Target role</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.target_role ?? "—"}</p></div>
        {student.placement_company && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Placed</label>
            <p style={{ margin: "2px 0 0" }}>{student.placement_role} at {student.placement_company}</p>
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
              <label style={{ fontSize: 12 }}>Paste raw transcript (optional)</label>
              <textarea className="input" rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={newSession.transcript_raw_text} onChange={(e) => setNewSession({ ...newSession, transcript_raw_text: e.target.value })} placeholder="Mayukh   0:03&#10;Let's get started..." />
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => openSession(s.id)}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{new Date(s.session_date).toLocaleDateString()}</strong>
                    {s.target_role && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{s.target_role}</span>}
                  </div>
                  {s.overall_score !== null && <span className="badge badge-info">{s.overall_score}/{s.overall_score_max ?? 10}</span>}
                </div>
                {openSessionId === s.id && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    {sessionLoading ? (
                      <p className="muted" style={{ fontSize: 12 }}>Loading...</p>
                    ) : sessionDetail ? (
                      <>
                        <ExecutiveAuditReportCard rawText={sessionDetail.raw_analysis_text} candidateName={student.name} targetRole={sessionDetail.target_role} onOpenModal={() => setModalSessionId(s.id)} />
                        {!sessionDetail.raw_analysis_text && (
                          <button className="btn-compact btn-sm" style={{ marginTop: 8 }} onClick={() => setModalSessionId(s.id)}>+ Add audit analysis</button>
                        )}
                        {sessionDetail.transcripts.map((t) => (
                          <details key={t.id} style={{ marginTop: 10 }}>
                            <summary style={{ fontSize: 12, cursor: "pointer" }}>Transcript ({t.source})</summary>
                            <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 6, fontSize: 12 }}>
                              {t.lines.map((l, i) => (
                                <p key={i} style={{ margin: "2px 0" }}><strong>{l.speaker}:</strong> {l.text}</p>
                              ))}
                            </div>
                          </details>
                        ))}
                      </>
                    ) : null}
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
          rawText={sessionDetail?.id === modalSessionId ? sessionDetail.raw_analysis_text : null}
          candidateName={student.name}
          targetRole={sessionDetail?.target_role}
          onClose={() => setModalSessionId(null)}
          onSaved={async () => {
            setModalSessionId(null);
            if (openSessionId) await openSession(openSessionId);
            await load();
          }}
        />
      )}

      <div className="card">
        <div className="page-header" style={{ marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Calendar</h3>
          <button className="btn-compact btn-sm" onClick={() => setShowNewEvent(!showNewEvent)}>{showNewEvent ? "Cancel" : "+ New event"}</button>
        </div>
        {showNewEvent && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input className="input" type="datetime-local" value={newEvent.event_date} onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })} style={{ maxWidth: 220 }} />
            <input className="input" placeholder="Title" value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} />
            <select className="input" style={{ maxWidth: 160 }} value={newEvent.event_type} onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}>
              <option value="mock_interview">Mock interview</option>
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="other">Other</option>
            </select>
            <button className="btn-primary btn-sm" onClick={createEvent}>Add</button>
          </div>
        )}
        <AuditCalendar events={calendarEvents} onDeleteEvent={deleteEvent} />
      </div>

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
    </div>
  );
}
