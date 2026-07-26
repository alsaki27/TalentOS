import { useEffect, useState } from "react";

interface Suggestion {
  skill: string;
  category: string;
  confidence: number;
  reason: string;
}

export function SourceOfTruthPanel({ candidateId, verifiedSkills }: { candidateId: string; verifiedSkills: string[] }) {
  const [sot, setSot] = useState<{ confirmedSkills: string[]; pendingSuggestions: Suggestion[]; lastParsedAt: string | null; parsedFromResumeName?: string | null; notes?: string | null } | null>(null);
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftResumeName, setDraftResumeName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Manual Add Form
  const [manualSkill, setManualSkill] = useState("");

  async function loadSot() {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth`);
      if (res.ok) {
        const data = await res.json();
        setSot(data);
        setDraftSkills(data.confirmedSkills || []);
        setDraftResumeName(data.parsedFromResumeName || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSot();
  }, [candidateId]);

  async function handleScanResume() {
    setActionLoading("trigger");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/scan-only`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDraftSkills(data.skills || []);
        setDraftResumeName(data.parsedFromResumeName || null);
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

  async function handleSaveToDatabase() {
    setActionLoading("save");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/skills/replace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: draftSkills }),
      });
      if (res.ok) {
        const data = await res.json();
        setSot(data);
        setDraftSkills(data.confirmedSkills || []);
        setDraftResumeName(data.parsedFromResumeName || null);
        alert("Skills successfully saved to Candidate Profile!");
      } else {
        const errText = await res.text();
        alert(`Failed to save skills: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  function handleAddManual() {
    const trimmed = manualSkill.trim();
    if (!trimmed) return;
    if (!draftSkills.includes(trimmed)) {
      setDraftSkills([...draftSkills, trimmed]);
    }
    setManualSkill("");
  }

  function removeSkill(skill: string) {
    setDraftSkills(draftSkills.filter(s => s !== skill));
  }

  if (loading) return <p className="muted">Loading Source of Truth...</p>;

  // Check if draft has unsaved changes compared to DB
  const hasUnsavedChanges = JSON.stringify(draftSkills) !== JSON.stringify(sot?.confirmedSkills || []);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Candidate Source of Truth</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={handleSaveToDatabase} disabled={actionLoading === "save" || !hasUnsavedChanges}>
            {actionLoading === "save" ? "Saving..." : "Save Source of Truth"}
          </button>
        </div>
      </div>
      
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        The Source of Truth represents the ledger of all skills the recruiter has confirmed this candidate is eligible to claim. 
        When tailoring applications, the AI can safely pull from this list without requiring explicit base resume evidence.
        {draftResumeName && (
          <span style={{ display: 'block', marginTop: '4px', fontStyle: 'italic', color: 'var(--color-primary)' }}>
            Skills extracted from base resume(s): <strong>{draftResumeName}</strong>
          </span>
        )}
      </p>

      {/* Unified Editable Box Section */}
      <div className="card" style={{ marginBottom: 20, border: hasUnsavedChanges ? "1px solid var(--accent)" : "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>
            Confirmed Skills ({draftSkills.length}) {hasUnsavedChanges && <span style={{ color: "var(--accent)", fontSize: 12, marginLeft: 8 }}>• Unsaved changes</span>}
          </h3>
          <button className="btn-compact btn-sm" onClick={handleScanResume} disabled={actionLoading === "trigger"}>
            {actionLoading === "trigger" ? "Running AI Scan..." : "Scan Resume for Skills"}
          </button>
        </div>
        
        {/* Add manual skill input inside the box */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input 
            type="text" 
            className="input" 
            placeholder="Add a skill manually (e.g. React, Python)" 
            value={manualSkill}
            onChange={(e) => setManualSkill(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddManual(); }}
            style={{ flex: 1 }}
          />
          <button className="btn-compact" onClick={handleAddManual}>Add Skill</button>
        </div>

        {draftSkills.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {draftSkills.map(skill => (
              <span key={skill} className="badge badge-success" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "4px 8px" }}>
                {skill}
                <button 
                  onClick={() => removeSkill(skill)}
                  style={{ background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer", opacity: 0.7 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>No skills in the draft yet. Scan the resume or add manually.</p>
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
    </div>
  );
}
