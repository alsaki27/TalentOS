"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ApplicationOption {
  id: string;
  candidate_id: string;
  job_id: string;
  candidate_name: string;
  candidate_email: string | null;
  job_title: string;
  job_company: string | null;
}

interface TeamUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
}

interface ScorecardTemplate {
  id: string;
  name: string;
  role_type: string;
  competencies: string[];
}

interface PanelMemberInput {
  userId: string;
  role: string;
}

const DURATIONS = [30, 45, 60, 90];
const LOCATIONS = ["Zoom", "Google Meet", "In-Person", "Phone", "Other"];

export default function ScheduleInterviewPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Candidate selection
  const [appSearch, setAppSearch] = useState("");
  const [appResults, setAppResults] = useState<ApplicationOption[]>([]);
  const [selectedApp, setSelectedApp] = useState<ApplicationOption | null>(null);

  // Round info
  const [roundName, setRoundName] = useState("");
  const [roundNumber, setRoundNumber] = useState(1);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("Zoom");
  const [meetingLink, setMeetingLink] = useState("");

  // Panel builder
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [panel, setPanel] = useState<PanelMemberInput[]>([]);
  const [panelSearch, setPanelSearch] = useState("");

  // Template
  const [templates, setTemplates] = useState<ScorecardTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ScorecardTemplate | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/users", { cache: "no-store" }).then((r) => r.ok && r.json()).then((u) => setUsers(u ?? []));
    fetch("/api/scorecard-templates", { cache: "no-store" }).then((r) => r.ok && r.json()).then((t) => setTemplates(t ?? []));
  }, []);

  async function searchApplications() {
    if (!appSearch.trim()) return;
    const res = await fetch(`/api/applications?search=${encodeURIComponent(appSearch)}&page=1&pageSize=20`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const mapped = (data.items ?? []).map((item: any) => ({
      id: item.id,
      candidate_id: item.candidate_id,
      job_id: item.job_id,
      candidate_name: item.candidates?.name || "Unknown",
      candidate_email: item.candidates?.email || null,
      job_title: item.jobs?.title || "—",
      job_company: item.jobs?.company || null,
    }));
    setAppResults(mapped);
  }

  function addPanelMember(userId: string) {
    if (panel.some((p) => p.userId === userId)) return;
    setPanel((prev) => [...prev, { userId, role: "interviewer" }]);
  }

  function removePanelMember(userId: string) {
    setPanel((prev) => prev.filter((p) => p.userId !== userId));
  }

  function updatePanelRole(userId: string, role: string) {
    setPanel((prev) => prev.map((p) => (p.userId === userId ? { ...p, role } : p)));
  }

  function loadTemplate(template: ScorecardTemplate) {
    setSelectedTemplate(template);
    setRoundName(template.name);
  }

  async function submit() {
    if (!selectedApp) { setError("Select a candidate application."); return; }
    if (!roundName) { setError("Enter a round name."); return; }
    if (!scheduledAt) { setError("Select a date and time."); return; }
    setLoading(true);
    setError("");

    const res = await fetch("/api/interviews", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationId: selectedApp.id,
        roundName,
        roundNumber,
        scheduledAt,
        durationMinutes: duration,
        location,
        meetingLink: meetingLink || null,
        panel: panel.map((p) => ({ interviewerId: p.userId, role: p.role })),
      }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not schedule interview.");
      return;
    }
    const data = await res.json();
    router.push(`/interviews/${data.id}`);
  }

  const filteredUsers = panelSearch.trim()
    ? users.filter((u) =>
        (u.display_name || "").toLowerCase().includes(panelSearch.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(panelSearch.toLowerCase())
      )
    : users.slice(0, 8);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Schedule Interview</h1>
          <div className="page-kicker">Create a new interview round for a candidate.</div>
        </div>
        <Link href="/interviews"><button>Back</button></Link>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="card" style={{ maxWidth: 720 }}>
        {/* Step 1: Candidate Selection */}
        <div className="section-title">1. Candidate Application</div>
        {selectedApp ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg)", borderRadius: "var(--radius)", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{selectedApp.candidate_name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{selectedApp.candidate_email}</div>
              <div className="muted" style={{ fontSize: 12 }}>{selectedApp.job_title} {selectedApp.job_company ? `• ${selectedApp.job_company}` : ""}</div>
            </div>
            <button className="btn-compact" onClick={() => setSelectedApp(null)}>Change</button>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                placeholder="Search candidates or jobs..."
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchApplications()}
                style={{ flex: 1 }}
              />
              <button className="btn-compact" onClick={searchApplications}>Search</button>
            </div>
            {appResults.length > 0 && (
              <div className="table-shell" style={{ maxHeight: 240, overflow: "auto" }}>
                <table className="table table-compact">
                  <tbody>
                    {appResults.map((app) => (
                      <tr key={app.id} style={{ cursor: "pointer" }} onClick={() => setSelectedApp(app)}>
                        <td className="cell-main">
                          <div style={{ fontWeight: 600 }}>{app.candidate_name}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{app.candidate_email}</div>
                        </td>
                        <td className="cell-main">
                          <div>{app.job_title}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{app.job_company}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Round Info */}
        <div className="section-title">2. Round Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
          <div className="field-group">
            <label>Round Name</label>
            <input value={roundName} onChange={(e) => setRoundName(e.target.value)} placeholder="e.g. Technical Interview" />
          </div>
          <div className="field-group">
            <label>Round Number</label>
            <input type="number" min={1} value={roundNumber} onChange={(e) => setRoundNumber(parseInt(e.target.value) || 1)} />
          </div>
          <div className="field-group">
            <label>Date & Time</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="field-group">
            <label>Duration</label>
            <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value))}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
          <div className="field-group">
            <label>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label>Meeting Link</label>
            <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        {/* Template Picker */}
        <div className="section-title">3. Scorecard Template</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <button className={!selectedTemplate ? "btn-primary" : ""} onClick={() => { setSelectedTemplate(null); setRoundName(""); }}>Custom</button>
          {templates.map((t) => (
            <button key={t.id} className={selectedTemplate?.id === t.id ? "btn-primary" : ""} onClick={() => loadTemplate(t)}>
              {t.name}
            </button>
          ))}
        </div>
        {selectedTemplate && (
          <div className="card" style={{ marginBottom: 16, background: "var(--bg)", fontSize: 12 }}>
            <div className="muted">Competencies:</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {(selectedTemplate.competencies ?? []).map((c) => <span key={c} className="badge">{c}</span>)}
            </div>
          </div>
        )}

        {/* Panel Builder */}
        <div className="section-title">4. Interview Panel</div>
        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Search team members..."
            value={panelSearch}
            onChange={(e) => setPanelSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 200, overflow: "auto" }}>
            {filteredUsers.map((u) => {
              const isSelected = panel.some((p) => p.userId === u.user_id);
              return (
                <button
                  key={u.user_id}
                  className={isSelected ? "btn-primary" : ""}
                  style={{ fontSize: 12, padding: "6px 10px" }}
                  onClick={() => isSelected ? removePanelMember(u.user_id) : addPanelMember(u.user_id)}
                >
                  {u.display_name || u.email} ({u.role.replaceAll("_", " ")})
                </button>
              );
            })}
          </div>
        </div>
        {panel.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {panel.map((p) => {
              const user = users.find((u) => u.user_id === p.userId);
              return (
                <div key={p.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 600, fontSize: 13, minWidth: 140 }}>{user?.display_name || user?.email}</span>
                  <select value={p.role} onChange={(e) => updatePanelRole(p.userId, e.target.value)} style={{ width: 140 }}>
                    <option value="interviewer">Interviewer</option>
                    <option value="shadow">Shadow</option>
                    <option value="observer">Observer</option>
                  </select>
                  <button className="btn-compact btn-danger" onClick={() => removePanelMember(p.userId)}>Remove</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 20 }}>
          <button className="btn-primary" onClick={submit} disabled={loading || !selectedApp}>
            {loading ? "Scheduling..." : "Schedule Interview"}
          </button>
        </div>
      </div>
    </>
  );
}
