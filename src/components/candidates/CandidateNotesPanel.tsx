import { useEffect, useState } from "react";

export function CandidateNotesPanel({ candidateId }: { candidateId: string }) {
  const [notes, setNotes] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [originalNotes, setOriginalNotes] = useState("");

  async function loadNotes() {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || "");
        setOriginalNotes(data.notes || "");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotes();
  }, [candidateId]);

  async function handleSaveNotes() {
    setActionLoading("save-notes");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/source-of-truth/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() }),
      });
      if (res.ok) {
        setIsEditingNotes(false);
        const data = await res.json();
        setNotes(data.notes || "");
        setOriginalNotes(data.notes || "");
      } else {
        const errText = await res.text();
        alert(`Failed to save notes: ${errText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <p className="muted">Loading Notes...</p>;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Notes & Caveats</h2>
      </div>
      
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        These notes and caveats will be passed to the AI whenever it generates a tailored resume. Use this space to document any specific preferences or rules for this candidate (e.g. "Do not mention React", "Exclude internship experience").
      </p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Candidate Notes</h3>
          {!isEditingNotes ? (
            <button className="btn-compact btn-sm" onClick={() => setIsEditingNotes(true)}>Edit Notes</button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-compact btn-sm" onClick={() => { setIsEditingNotes(false); setNotes(originalNotes); }}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleSaveNotes} disabled={actionLoading === "save-notes"}>
                {actionLoading === "save-notes" ? "Saving..." : "Save Notes"}
              </button>
            </div>
          )}
        </div>
        
        {isEditingNotes ? (
          <textarea
            className="input"
            style={{ width: "100%", minHeight: "200px", resize: "vertical" }}
            placeholder="Add specific caveats, preferences, or notes about this candidate's skills..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={actionLoading === "save-notes"}
          />
        ) : (
          <div className="muted" style={{ fontSize: 14, minHeight: 40, whiteSpace: "pre-wrap" }}>
            {originalNotes ? originalNotes : "No notes or caveats added yet."}
          </div>
        )}
      </div>
    </div>
  );
}
