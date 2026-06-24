"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ScorecardForm from "@/components/ScorecardForm";
import ConsensusPanel from "@/components/ConsensusPanel";

interface Profile {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
}

interface PanelMember {
  id: string;
  interviewer_id: string;
  role: string;
  status: string;
  feedback_submitted: boolean;
  profile: Profile | null;
}

interface Scorecard {
  id: string;
  overall_rating: number | null;
  recommendation: string | null;
  competencies: any[];
  overall_notes: string | null;
  verdict_notes: string | null;
  submitted_at: string | null;
  panel_member_id: string;
}

interface InterviewDetail {
  id: string;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  duration_minutes: number;
  status: string;
  location: string | null;
  meeting_link: string | null;
  applications: {
    candidate_id: string;
    job_id: string;
    candidates: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      resume_url: string | null;
      resume_filename: string | null;
    } | null;
    jobs: {
      id: string;
      title: string;
      company: string | null;
      location: string | null;
    } | null;
  } | null;
  panel: PanelMember[];
  scorecards: Scorecard[];
}

interface MeResponse {
  profile: {
    user_id: string;
    role: string;
    display_name: string;
    email: string;
  };
}

interface TeamUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "scheduled": return "badge-scheduled";
    case "completed": return "badge-offer";
    case "cancelled": return "badge-closed";
    case "no_show": return "badge-rejected";
    case "in_progress": return "badge-in_progress";
    default: return "badge";
  }
}

export default function InterviewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addPanelUserId, setAddPanelUserId] = useState("");
  const [addPanelRole, setAddPanelRole] = useState("interviewer");
  const [actionLoading, setActionLoading] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<any[]>([]);
  const [consensus, setConsensus] = useState<any>(null);

  async function load() {
    setLoading(true);
    setFeedback(null);
    try {
      const [interviewRes, meRes, usersRes, consensusRes] = await Promise.all([
        fetch(`/api/interviews/${id}`, { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
        fetch(`/api/interviews/${id}/scorecard`, { cache: "no-store" }),
      ]);
      if (!interviewRes.ok) throw new Error("Could not load interview.");
      const data = await interviewRes.json();
      setInterview(data);
      if (meRes.ok) setMe(await meRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (consensusRes.ok) {
        const consensusData = await consensusRes.json();
        setConsensus(consensusData);
      }
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Could not load interview." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  const myPanelMember = interview?.panel.find((p) => p.interviewer_id === me?.profile.user_id);
  const myScorecard = interview?.scorecards.find((s) => s.panel_member_id === myPanelMember?.id);
  const canManage = ["admin", "manager", "application_engineer"].includes(me?.profile.role ?? "");

  async function updateStatus(status: string) {
    setActionLoading(status);
    setFeedback(null);
    const res = await fetch(`/api/interviews/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setActionLoading("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not update interview." });
      return;
    }
    setFeedback({ kind: "success", text: `Interview ${status.replaceAll("_", " ")}.` });
    load();
  }

  async function advanceToNextRound() {
    if (!interview) return;
    setActionLoading("advance");
    setFeedback(null);
    const nextRound = (interview.round_number ?? 1) + 1;
    const res = await fetch(`/api/interviews/${id}`, {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "scheduled",
        round_number: nextRound,
        round_name: `Round ${nextRound}`,
      }),
    });
    setActionLoading("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not advance to next round." });
      return;
    }
    setFeedback({ kind: "success", text: `Advanced to Round ${nextRound}.` });
    load();
  }

  async function addPanelMember() {
    if (!addPanelUserId) return;
    setActionLoading("addPanel");
    setFeedback(null);
    const res = await fetch(`/api/interviews/${id}/panel`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId: addPanelUserId, role: addPanelRole }),
    });
    setActionLoading("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not add panel member." });
      return;
    }
    setShowAddPanel(false);
    setAddPanelUserId("");
    setAddPanelRole("interviewer");
    setFeedback({ kind: "success", text: "Panel member added." });
    load();
  }

  async function removePanelMember(panelMemberId: string) {
    if (!confirm("Remove this panel member?")) return;
    setActionLoading(`remove:${panelMemberId}`);
    setFeedback(null);
    const res = await fetch(`/api/interviews/${id}/panel?panelMemberId=${panelMemberId}`, {
      method: "DELETE",
      cache: "no-store",
    });
    setActionLoading("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not remove panel member." });
      return;
    }
    setFeedback({ kind: "success", text: "Panel member removed." });
    load();
  }

  async function submitScorecard(data: any) {
    if (!myPanelMember) return;
    setActionLoading("scorecard");
    setFeedback(null);
    const res = await fetch(`/api/interviews/${id}/scorecard`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        panelMemberId: myPanelMember.id,
        overallRating: data.overallRating,
        recommendation: data.recommendation,
        competencies: data.competencies,
        overallNotes: data.overallNotes,
        verdictNotes: data.verdictNotes,
      }),
    });
    setActionLoading("");
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: d.error || "Could not submit scorecard." });
      return;
    }
    setFeedback({ kind: "success", text: "Scorecard submitted." });
    load();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    // Placeholder: notes are not persisted in the schema; using a local state for now.
    // In a real system, this would POST to /api/interviews/{id}/notes
    setNotes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: noteText,
        created_at: new Date().toISOString(),
        author: me?.profile.display_name || me?.profile.email || "You",
      },
    ]);
    setNoteText("");
  }

  if (loading) return <div className="loading-panel">Loading interview...</div>;
  if (!interview) return <div className="empty">Interview not found.</div>;

  const candidate = interview.applications?.candidates;
  const job = interview.applications?.jobs;
  const isActive = interview.status === "scheduled" || interview.status === "in_progress";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{interview.round_name}</h1>
          <div className="page-kicker">
            Round {interview.round_number} • {interview.applications?.candidates?.name ?? "—"} • {interview.applications?.jobs?.title ?? "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/interviews"><button>Back</button></Link>
        </div>
      </div>

      {feedback && <div className={`toast ${feedback.kind === "error" ? "toast-error" : ""}`}>{feedback.text}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        <div>
          {/* Candidate Info Card */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Candidate</div>
            {candidate ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  <Link className="row-link" href={`/candidates/${candidate.id}`}>{candidate.name}</Link>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{candidate.email}</div>
                {candidate.phone && <div className="muted" style={{ fontSize: 13 }}>{candidate.phone}</div>}
                {candidate.resume_url && (
                  <a href={candidate.resume_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    Resume{candidate.resume_filename ? `: ${candidate.resume_filename}` : ""}
                  </a>
                )}
              </div>
            ) : (
              <div className="muted">Candidate info unavailable.</div>
            )}
          </div>

          {/* Interview Info */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Interview Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontSize: 13 }}>
              <div><span className="muted">Date:</span> {interview.scheduled_at ? new Date(interview.scheduled_at).toLocaleString() : "—"}</div>
              <div><span className="muted">Duration:</span> {interview.duration_minutes} min</div>
              <div><span className="muted">Location:</span> {interview.location || "—"}</div>
              <div><span className="muted">Status:</span> <span className={`badge ${statusBadgeClass(interview.status)}`}>{interview.status}</span></div>
              {interview.meeting_link && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="muted">Meeting Link:</span>{" "}
                  <a href={interview.meeting_link} target="_blank" rel="noreferrer">{interview.meeting_link}</a>
                </div>
              )}
            </div>
          </div>

          {/* Panel Section */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0 }}>Panel</div>
              {canManage && (
                <button className="btn-compact" onClick={() => setShowAddPanel(true)}>Add Interviewer</button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {interview.panel.map((p) => (
                <div key={p.id} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="avatar-circle" style={{ width: 36, height: 36, fontSize: 13 }}>
                      {initials(p.profile?.display_name || p.profile?.email)}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.profile?.display_name || p.profile?.email || "Unknown"}</div>
                      <div className="muted" style={{ fontSize: 11, textTransform: "capitalize" }}>{p.role}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                    <span className={`badge ${p.status === "confirmed" ? "badge-review-approved" : p.status === "declined" ? "badge-review-changes_requested" : "badge-review-pending"}`}>
                      {p.status}
                    </span>
                    {p.feedback_submitted && <span className="badge badge-offer" style={{ fontSize: 10 }}>Feedback</span>}
                  </div>
                  {canManage && (
                    <button
                      className="btn-compact btn-danger"
                      style={{ marginTop: 8, fontSize: 11, padding: "4px 8px" }}
                      disabled={actionLoading === `remove:${p.id}`}
                      onClick={() => removePanelMember(p.id)}
                    >
                      {actionLoading === `remove:${p.id}` ? "Removing..." : "Remove"}
                    </button>
                  )}
                </div>
              ))}
              {interview.panel.length === 0 && <div className="muted">No panel members assigned.</div>}
            </div>
          </div>

          {/* Scorecard Section */}
          {(interview.status === "completed" || interview.status === "in_progress") && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Scorecards</div>

              {myPanelMember && !myScorecard && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-title" style={{ fontSize: 14 }}>Your Scorecard</div>
                  <ScorecardForm
                    competencies={["Technical Skills", "Communication", "Problem Solving", "Culture Fit"]}
                    onSubmit={submitScorecard}
                  />
                </div>
              )}

              {myScorecard && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-title" style={{ fontSize: 14 }}>Your Scorecard (submitted)</div>
                  <ScorecardForm
                    competencies={["Technical Skills", "Communication", "Problem Solving", "Culture Fit"]}
                    onSubmit={() => {}}
                    readOnly
                    initialData={{
                      overallRating: myScorecard.overall_rating ?? 0,
                      recommendation: myScorecard.recommendation ?? "",
                      competencies: Array.isArray(myScorecard.competencies) ? myScorecard.competencies : [],
                      overallNotes: myScorecard.overall_notes ?? "",
                      verdictNotes: myScorecard.verdict_notes ?? "",
                    }}
                  />
                </div>
              )}

              {consensus && interview.scorecards.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <ConsensusPanel scorecards={consensus} />
                </div>
              )}
            </div>
          )}

          {/* Notes Thread */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Notes</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                style={{ flex: 1 }}
              />
              <button className="btn-compact" onClick={addNote}>Add</button>
            </div>
            {notes.length === 0 && <div className="muted">No notes yet.</div>}
            {notes.map((n) => (
              <div key={n.id} style={{ padding: 8, borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{n.author} <span className="muted">{new Date(n.created_at).toLocaleString()}</span></div>
                <div>{n.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar: Action Bar */}
        <div>
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {isActive && (
                <button
                  className="btn-primary"
                  disabled={actionLoading === "completed"}
                  onClick={() => updateStatus("completed")}
                >
                  {actionLoading === "completed" ? "Completing..." : "Complete Interview"}
                </button>
              )}
              {isActive && (
                <button
                  disabled={actionLoading === "cancelled"}
                  onClick={() => updateStatus("cancelled")}
                >
                  {actionLoading === "cancelled" ? "Cancelling..." : "Cancel Interview"}
                </button>
              )}
              {isActive && (
                <button
                  disabled={actionLoading === "in_progress"}
                  onClick={() => updateStatus("in_progress")}
                >
                  {actionLoading === "in_progress" ? "Starting..." : "Start Interview"}
                </button>
              )}
              {interview.status === "completed" && (
                <>
                  <button
                    className="btn-primary"
                    disabled={actionLoading === "advance"}
                    onClick={advanceToNextRound}
                  >
                    Advance to Next Round
                  </button>
                  <button
                    className="btn-primary"
                    disabled={actionLoading === "offer" || !job?.id || !candidate?.id}
                    onClick={() => {
                      if (!job?.id || !candidate?.id) return;
                      router.push(`/jobs/${job.id}/offer?candidate=${candidate.id}`);
                    }}
                  >
                    Send Offer
                  </button>
                  <button
                    className="btn-danger"
                    disabled={actionLoading === "rejected"}
                    onClick={() => updateStatus("no_show")}
                  >
                    Reject
                  </button>
                </>
              )}
              {canManage && (
                <button
                  disabled={actionLoading === "delete"}
                  onClick={async () => {
                    if (!confirm("Delete this interview?")) return;
                    setActionLoading("delete");
                    const res = await fetch(`/api/interviews/${id}`, { method: "DELETE", cache: "no-store" });
                    setActionLoading("");
                    if (!res.ok) {
                      const d = await res.json().catch(() => ({}));
                      setFeedback({ kind: "error", text: d.error || "Could not delete." });
                      return;
                    }
                    router.push("/interviews");
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Panel Modal */}
      {showAddPanel && (
        <div className="modal-overlay" onClick={() => setShowAddPanel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Interviewer</h2>
            <div className="field-group">
              <label>Interviewer</label>
              <select value={addPanelUserId} onChange={(e) => setAddPanelUserId(e.target.value)}>
                <option value="">Select user...</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name || u.email} ({u.role.replaceAll("_", " ")})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label>Role</label>
              <select value={addPanelRole} onChange={(e) => setAddPanelRole(e.target.value)}>
                <option value="interviewer">Interviewer</option>
                <option value="shadow">Shadow</option>
                <option value="observer">Observer</option>
              </select>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowAddPanel(false)}>Cancel</button>
              <button className="btn-primary" onClick={addPanelMember} disabled={actionLoading === "addPanel" || !addPanelUserId}>
                {actionLoading === "addPanel" ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
