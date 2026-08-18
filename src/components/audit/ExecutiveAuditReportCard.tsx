"use client";
import { useState } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, Target, Copy, Check, Edit3, BarChart2, Quote, ChevronDown, ChevronUp } from "lucide-react";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

interface Props {
  rawText: string | null;
  candidateName?: string;
  targetRole?: string | null;
  onOpenModal?: () => void;
}

export function ExecutiveAuditReportCard({ rawText, candidateName, targetRole, onOpenModal }: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const parsed = parseAuditAnalysis(rawText || "");
  if (!parsed || (!parsed.metrics.length && !parsed.strengths.length && !parsed.weaknesses.length && !parsed.actionItems.length)) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText || "");
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const getMetricColor = (score: number | null, max = 10) => {
    const ratio = (score ?? 0) / max;
    if (ratio >= 0.8) return { bar: "#059669", bg: "rgba(5, 150, 105, 0.12)", text: "#059669" };
    if (ratio >= 0.65) return { bar: "#0284c7", bg: "rgba(2, 132, 199, 0.12)", text: "#0284c7" };
    if (ratio >= 0.5) return { bar: "#d97706", bg: "rgba(217, 119, 6, 0.12)", text: "#d97706" };
    return { bar: "#dc2626", bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626" };
  };

  const overallScoreVal = parsed.overallScore ?? 0;

  return (
    <div className="card" style={{ padding: "1.75rem 2rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "1rem",
          marginBottom: "1.25rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.3rem" }}>
            <span
              style={{
                background: "linear-gradient(135deg, var(--warn) 0%, #e04343 100%)",
                color: "#fff",
                fontSize: "0.72rem",
                fontWeight: 900,
                padding: "3px 8px",
                borderRadius: 6,
                letterSpacing: "0.03em",
              }}
            >
              EXECUTIVE AUDIT
            </span>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 900, color: "var(--ink)", margin: 0 }}>
              Candidate Performance Metrics &amp; Evaluation Breakdown
            </h3>
          </div>
          <span style={{ fontSize: "0.86rem", color: "var(--ink-soft)", fontWeight: 500 }}>
            Multi-dimensional audit report, verbatim quote analysis &amp; mentor action plan
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <button type="button" onClick={handleCopy} className="btn-compact" title="Copy Report">
            {isCopied ? <Check size={14} color="#059669" /> : <Copy size={14} />} {isCopied ? "Copied" : "Copy"}
          </button>
          {onOpenModal && (
            <button type="button" onClick={onOpenModal} className="btn-primary btn-compact">
              <Edit3 size={14} /> Full View / Edit
            </button>
          )}
          <button type="button" onClick={() => setIsCollapsed(!isCollapsed)} className="btn-compact" title={isCollapsed ? "Expand" : "Collapse"}>
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "1.25rem 1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1.25rem",
            }}
          >
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}>
                <strong style={{ fontSize: "1.1rem", color: "var(--ink)" }}>{parsed.candidateName || candidateName}</strong>
                {(parsed.targetRole || targetRole) && (
                  <span style={{ fontSize: "0.76rem", fontWeight: 800, color: "var(--warn)", background: "rgba(251,146,60,0.14)", padding: "2px 8px", borderRadius: 5 }}>
                    🎯 {parsed.targetRole || targetRole}
                  </span>
                )}
              </div>
              {parsed.overallSummary && (
                <p style={{ fontSize: "0.88rem", color: "var(--ink)", margin: 0, fontWeight: 500, lineHeight: 1.5 }}>{parsed.overallSummary}</p>
              )}
            </div>

            <div style={{ background: "var(--surface)", border: "2px solid var(--border)", borderRadius: 14, padding: "0.75rem 1.4rem", textAlign: "center" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase" }}>Overall Assessment</span>
              <div
                style={{
                  fontSize: "1.8rem",
                  fontWeight: 900,
                  color: overallScoreVal >= 8 ? "#059669" : overallScoreVal >= 6 ? "#0284c7" : "#dc2626",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "center",
                  gap: 3,
                }}
              >
                {overallScoreVal.toFixed(1)}
                <span style={{ fontSize: "0.9rem", color: "var(--ink-soft)", fontWeight: 700 }}>/ 10</span>
              </div>
            </div>
          </div>

          {parsed.metrics.length > 0 && (
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 900, color: "var(--ink)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <BarChart2 size={17} color="var(--warn)" /> Performance Metrics
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.75rem" }}>
                {parsed.metrics.map((metric, idx) => {
                  const col = getMetricColor(metric.score, metric.maxScore);
                  const pct = Math.min(100, Math.round(((metric.score ?? 0) / metric.maxScore) * 100));
                  return (
                    <div key={idx} style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, padding: "0.9rem 1.1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                        <strong style={{ fontSize: "0.86rem", color: "var(--ink)" }}>{metric.name}</strong>
                        <span style={{ fontSize: "0.8rem", fontWeight: 900, color: col.text, background: col.bg, padding: "2px 8px", borderRadius: 5 }}>
                          {metric.score} / {metric.maxScore}
                        </span>
                      </div>
                      <div style={{ width: "100%", height: 6, background: "rgba(0,0,0,0.2)", borderRadius: 99, overflow: "hidden", marginBottom: "0.4rem" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: col.bar, borderRadius: 99 }} />
                      </div>
                      {metric.note && <p style={{ fontSize: "0.76rem", color: "var(--ink-soft)", margin: 0, lineHeight: 1.4 }}>{metric.note}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {parsed.strengths.length > 0 && (
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 900, color: "#059669", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <CheckCircle2 size={18} color="#059669" /> Strengths
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.75rem" }}>
                {parsed.strengths.map((str, idx) => (
                  <div key={idx} style={{ background: "rgba(5,150,105,0.08)", border: "1px solid rgba(5,150,105,0.3)", borderRadius: 12, padding: "0.95rem 1.15rem", display: "flex", gap: "0.65rem" }}>
                    <CheckCircle2 size={17} color="#059669" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong style={{ fontSize: "0.88rem", color: "#34d399", display: "block", marginBottom: "0.2rem" }}>{str.title}</strong>
                      <p style={{ fontSize: "0.82rem", color: "var(--ink)", margin: 0, lineHeight: 1.45 }}>{str.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.weaknesses.length > 0 && (
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 900, color: "#dc2626", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <AlertTriangle size={18} color="#dc2626" /> Critical Weaknesses &amp; Corrections
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                {parsed.weaknesses.map((weak, idx) => (
                  <div key={idx} style={{ background: "var(--surface-raised)", border: "1px solid rgba(220,38,38,0.35)", borderLeft: "4px solid #dc2626", borderRadius: 12, padding: "1.15rem 1.25rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.4rem" }}>
                      <span style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.4)", padding: "2px 7px", borderRadius: 5, fontSize: "0.72rem", fontWeight: 800 }}>
                        #{idx + 1}
                      </span>
                      <strong style={{ fontSize: "0.92rem", color: "var(--ink)" }}>{weak.title}</strong>
                    </div>
                    {weak.mistake && <p style={{ fontSize: "0.84rem", color: "var(--ink)", margin: "0 0 0.5rem 0", lineHeight: 1.45 }}>{weak.mistake}</p>}
                    {weak.quote && (
                      <div style={{ background: "rgba(239,68,68,0.1)", borderLeft: "3px solid #ef4444", padding: "0.55rem 0.85rem", borderRadius: "0 6px 6px 0", marginBottom: "0.55rem", display: "flex", gap: "0.45rem", alignItems: "flex-start" }}>
                        <Quote size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                        <div style={{ fontSize: "0.8rem", color: "#fca5a5", fontStyle: "italic", lineHeight: 1.4 }}>&quot;{weak.quote}&quot;</div>
                      </div>
                    )}
                    {weak.correction && (
                      <div style={{ background: "rgba(2,132,199,0.1)", border: "1px solid rgba(2,132,199,0.3)", padding: "0.65rem 0.85rem", borderRadius: 8, display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                        <Sparkles size={15} color="#0284c7" style={{ flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <strong style={{ fontSize: "0.76rem", color: "#38bdf8", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Mentor Correction:</strong>
                          <p style={{ fontSize: "0.82rem", color: "var(--ink)", margin: 0, lineHeight: 1.45 }}>{weak.correction}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.actionItems.length > 0 && (
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 900, color: "var(--accent)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <Target size={18} color="var(--accent)" /> Action Items for Mentor
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.75rem" }}>
                {parsed.actionItems.map((act, idx) => (
                  <div key={idx} style={{ background: "var(--accent-soft)", border: "1px solid rgba(139,92,246,0.35)", borderRadius: 12, padding: "0.95rem 1.15rem", display: "flex", gap: "0.65rem" }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent) 0%, #4c1d95 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "0.72rem", flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div>
                      <strong style={{ fontSize: "0.86rem", color: "var(--accent-hover)", display: "block", marginBottom: "0.2rem" }}>{act.title}</strong>
                      <p style={{ fontSize: "0.82rem", color: "var(--ink)", margin: 0, lineHeight: 1.45 }}>{act.action}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
