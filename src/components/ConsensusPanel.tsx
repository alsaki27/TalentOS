"use client";

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

interface ConsensusData {
  overallRating: number;
  overallRatingCount: number;
  competencies: { name: string; average: number; count: number; notes: string[] }[];
  recommendations: { recommendation: string; count: number }[];
  verdict: string;
  scorecards: Scorecard[];
}

function recLabel(rec: string) {
  const map: Record<string, string> = {
    strong_hire: "Strong Hire",
    hire: "Hire",
    lean_hire: "Lean Hire",
    no_hire: "No Hire",
    strong_no_hire: "Strong No Hire",
  };
  return map[rec] || rec;
}

function recColor(rec: string) {
  if (rec.includes("hire") && !rec.includes("no")) return "var(--accent)";
  if (rec.includes("no")) return "var(--danger)";
  return "var(--ink-soft)";
}

export default function ConsensusPanel({ scorecards }: { scorecards: ConsensusData }) {
  const { overallRating, overallRatingCount, competencies, recommendations, verdict } = scorecards;

  const maxRec = recommendations.length > 0 ? Math.max(...recommendations.map((r) => r.count)) : 0;

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>Consensus</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>
            {overallRating > 0 ? overallRating.toFixed(1) : "—"}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Avg Overall Rating</div>
          <div className="muted" style={{ fontSize: 11 }}>{overallRatingCount} submitted</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: verdict === "Hire" ? "var(--accent)" : verdict === "No Hire" ? "var(--danger)" : "var(--warn)" }}>
            {verdict}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Verdict</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ink)" }}>
            {scorecards.scorecards.length}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Scorecards</div>
        </div>
      </div>

      {competencies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-title">Competency Averages</div>
          {competencies.map((c) => (
            <div key={c.name} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span>{c.name}</span>
                <span style={{ fontWeight: 700 }}>{c.average.toFixed(1)} / 5</span>
              </div>
              <div style={{ height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(c.average / 5) * 100}%`,
                    background: c.average >= 3.5 ? "var(--accent)" : c.average >= 2.5 ? "var(--warn)" : "var(--danger)",
                    borderRadius: 4,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-title">Recommendation Distribution</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {recommendations.map((r) => (
              <div
                key={r.recommendation}
                style={{
                  padding: "8px 14px",
                  borderRadius: "var(--radius)",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                  minWidth: 100,
                }}
              >
                <div style={{ fontWeight: 700, color: recColor(r.recommendation) }}>
                  {recLabel(r.recommendation)}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>
                  {r.count}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {maxRec > 0 ? `${Math.round((r.count / maxRec) * 100)}% relative` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
