"use client";

import { useState } from "react";

interface Competency {
  name: string;
  rating: number;
  notes: string;
}

interface ScorecardFormData {
  overallRating: number;
  recommendation: string;
  competencies: Competency[];
  overallNotes: string;
  verdictNotes: string;
}

interface ScorecardFormProps {
  competencies: string[];
  onSubmit: (data: ScorecardFormData) => void;
  readOnly?: boolean;
  initialData?: Partial<ScorecardFormData>;
}

const RECOMMENDATIONS = [
  { value: "strong_hire", label: "Strong Hire" },
  { value: "hire", label: "Hire" },
  { value: "lean_hire", label: "Lean Hire" },
  { value: "no_hire", label: "No Hire" },
  { value: "strong_no_hire", label: "Strong No Hire" },
];

function StarRating({
  value,
  onChange,
  readOnly,
}: {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readOnly && setHover(star)}
          onMouseLeave={() => setHover(0)}
          disabled={readOnly}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontSize: 20,
            cursor: readOnly ? "default" : "pointer",
            color: star <= (hover || value) ? "var(--warn)" : "var(--border)",
            lineHeight: 1,
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ScorecardForm({
  competencies,
  onSubmit,
  readOnly,
  initialData,
}: ScorecardFormProps) {
  const [overallRating, setOverallRating] = useState(initialData?.overallRating ?? 0);
  const [recommendation, setRecommendation] = useState(initialData?.recommendation ?? "");
  const [overallNotes, setOverallNotes] = useState(initialData?.overallNotes ?? "");
  const [verdictNotes, setVerdictNotes] = useState(initialData?.verdictNotes ?? "");
  const [competencyList, setCompetencyList] = useState<Competency[]>(
    initialData?.competencies?.length
      ? initialData.competencies
      : competencies.map((name) => ({ name, rating: 0, notes: "" }))
  );

  function setCompetencyRating(index: number, rating: number) {
    setCompetencyList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], rating };
      return next;
    });
  }

  function setCompetencyNotes(index: number, notes: string) {
    setCompetencyList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], notes };
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      overallRating,
      recommendation,
      competencies: competencyList,
      overallNotes,
      verdictNotes,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="section-title" style={{ marginTop: 0 }}>Competencies</div>
      {competencyList.map((comp, i) => (
        <div key={comp.name} style={{ marginBottom: 14, padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{comp.name}</span>
            <StarRating
              value={comp.rating}
              onChange={readOnly ? undefined : (v) => setCompetencyRating(i, v)}
              readOnly={readOnly}
            />
          </div>
          <textarea
            rows={2}
            placeholder="Notes..."
            value={comp.notes}
            onChange={(e) => setCompetencyNotes(i, e.target.value)}
            readOnly={readOnly}
            style={{ background: readOnly ? "var(--bg)" : undefined }}
          />
        </div>
      ))}

      <div className="section-title">Overall Rating</div>
      <StarRating
        value={overallRating}
        onChange={readOnly ? undefined : setOverallRating}
        readOnly={readOnly}
      />

      <div className="section-title" style={{ marginTop: 16 }}>Recommendation</div>
      <select
        value={recommendation}
        onChange={(e) => setRecommendation(e.target.value)}
        disabled={readOnly}
        style={{ background: readOnly ? "var(--bg)" : undefined }}
      >
        <option value="">Select...</option>
        {RECOMMENDATIONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <div className="section-title" style={{ marginTop: 16 }}>Overall Notes</div>
      <textarea
        rows={3}
        placeholder="General observations..."
        value={overallNotes}
        onChange={(e) => setOverallNotes(e.target.value)}
        readOnly={readOnly}
        style={{ background: readOnly ? "var(--bg)" : undefined }}
      />

      <div className="section-title" style={{ marginTop: 16 }}>Verdict Notes</div>
      <textarea
        rows={2}
        placeholder="Hiring committee notes..."
        value={verdictNotes}
        onChange={(e) => setVerdictNotes(e.target.value)}
        readOnly={readOnly}
        style={{ background: readOnly ? "var(--bg)" : undefined }}
      />

      {!readOnly && (
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn-primary" type="submit">Submit Scorecard</button>
        </div>
      )}
    </form>
  );
}
