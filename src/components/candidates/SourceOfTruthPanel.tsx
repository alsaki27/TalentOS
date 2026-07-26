"use client";

import { useEffect, useState } from "react";
import type { SourceOfTruthData } from "@/lib/ai/application-agents/types";

interface Suggestion {
  skill: string;
  category: string;
  confidence: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
}

export function SourceOfTruthPanel({ candidateId, verifiedSkills }: { candidateId: string; verifiedSkills: string[] }) {
  const [sot, setSot] = useState<{ confirmedSkills: string[]; pendingSuggestions: Suggestion[]; lastParsedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Manual Add Form
  const [showAdd, setShowAdd] = useState(false);
  const [manualSkill, setManualSkill] = useState("");
  const [manualCategory, setManualCategory] = useState("Manual");

  useEffect(() => {
    loadSot();
  }, []);

  async function loadSot() {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth`);
      if (res.ok) {
        setSot(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoTrigger() {
    setActionLoading("trigger");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/auto-trigger`, { method: "POST" });
      if (res.ok) {
        setSot(await res.json());
      } else {
        const errText = await res.text();
        alert(`Failed to scan resume: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAutoAccept() {
    setActionLoading("auto-accept");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/auto-accept`, { method: "POST" });
      if (res.ok) {
        await loadSot();
      } else {
        const errText = await res.text();
        alert(`Failed to auto-accept skills: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAddManual() {
    if (!manualSkill.trim()) return;
    setActionLoading("manual-add");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: manualSkill.trim(), category: manualCategory }),
      });
      if (res.ok) {
        setManualSkill("");
        setShowAdd(false);
        await loadSot();
      } else {
        const errText = await res.text();
        alert(`Failed to add manual skill: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function updateSuggestionStatus(skill: string, status: "accepted" | "rejected") {
    setActionLoading(`update-${skill}`);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill, status }),
      });
      if (res.ok) {
        await loadSot();
      } else {
        const errText = await res.text();
        alert(`Failed to update skill status: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function removeSkill(skill: string) {
    if (!confirm(`Remove "${skill}" from confirmed skills?`)) return;
    setActionLoading(`remove-${skill}`);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/skills`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });
      if (res.ok) {
        await loadSot();
      } else {
        const errText = await res.text();
        alert(`Failed to remove skill: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <p className="muted">Loading Source of Truth...</p>;

  return (
    <div>
      <div className="page-header">
        <h2 style={{ fontSize: 16, margin: 0 }}>Candidate Source of Truth</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAdd(true)}>+ Add Manual Skill</button>
          <button className="btn-primary" onClick={handleAutoTrigger} disabled={actionLoading === "trigger"}>
            {actionLoading === "trigger" ? "Running AI Scan..." : "Scan Resume for Skills"}
          </button>
        </div>
      </div>
      
      <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 20 }}>
        The Source of Truth represents the ledger of all skills the recruiter has confirmed this candidate is eligible to claim. 
        When tailoring applications, the AI can safely pull from this list without requiring explicit base resume evidence.
      </p>

      {/* Confirmed Skills Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>Confirmed Skills ({sot?.confirmedSkills.length || 0})</h3>
        {sot?.confirmedSkills && sot.confirmedSkills.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sot.confirmedSkills.map(skill => (
              <span key={skill} className="badge badge-success" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "4px 8px" }}>
                {skill}
                <button 
                  onClick={() => removeSkill(skill)}
                  disabled={actionLoading === `remove-${skill}`}
                  style={{ background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer", opacity: 0.7 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>No confirmed skills yet. Scan the resume or add manually.</p>
        )}
      </div>

      {/* Legacy Verified Skills (Read-Only) */}
      {verifiedSkills && verifiedSkills.length > 0 && (
        <div className="card" style={{ marginBottom: 20, border: "1px dashed var(--border)" }}>
          <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12, color: "var(--muted)" }}>Legacy Verified Skills</h3>
          <p className="muted" style={{ fontSize: 12, marginBottom: 12, marginTop: -8 }}>These are from the old verified_skills column and should be migrated.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {verifiedSkills.map(skill => (
              <span key={skill} className="badge" style={{ fontSize: 13, padding: "4px 8px", opacity: 0.7 }}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestions Section */}
      {sot?.pendingSuggestions && sot.pendingSuggestions.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>AI Skill Suggestions ({sot.pendingSuggestions.length})</h3>
            <button 
              className="btn-sm" 
              onClick={handleAutoAccept} 
              disabled={actionLoading === "auto-accept"}
            >
              {actionLoading === "auto-accept" ? "Accepting..." : "Auto-Accept High Confidence (≥90%)"}
            </button>
          </div>
          
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Category</th>
                  <th>Confidence</th>
                  <th>Reasoning</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sot.pendingSuggestions.map((sug, i) => (
                  <tr key={i}>
                    <td><strong>{sug.skill}</strong></td>
                    <td className="muted" style={{ fontSize: 13 }}>{sug.category}</td>
                    <td>
                      <span className={`badge ${sug.confidence >= 0.9 ? "badge-success" : sug.confidence >= 0.7 ? "badge-warning" : "badge-danger"}`}>
                        {Math.round(sug.confidence * 100)}%
                      </span>
                    </td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 300, whiteSpace: "normal" }}>
                      {sug.reason}
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button 
                        className="btn-success btn-sm btn-compact"
                        onClick={() => updateSuggestionStatus(sug.skill, "accepted")}
                        disabled={actionLoading === `update-${sug.skill}`}
                      >
                        ✓ Accept
                      </button>
                      <button 
                        className="btn-danger btn-sm btn-compact"
                        onClick={() => updateSuggestionStatus(sug.skill, "rejected")}
                        disabled={actionLoading === `update-${sug.skill}`}
                      >
                        ✕ Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Add Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Confirmed Skill</h2>
            <div className="field-group">
              <label>Skill Name</label>
              <input 
                autoFocus
                value={manualSkill} 
                onChange={(e) => setManualSkill(e.target.value)} 
                placeholder="e.g. React.js"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddManual();
                }}
              />
            </div>
            <div className="field-group">
              <label>Category</label>
              <input 
                value={manualCategory} 
                onChange={(e) => setManualCategory(e.target.value)} 
                placeholder="e.g. Framework"
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddManual} disabled={actionLoading === "manual-add" || !manualSkill.trim()}>
                {actionLoading === "manual-add" ? "Adding..." : "Add Skill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
