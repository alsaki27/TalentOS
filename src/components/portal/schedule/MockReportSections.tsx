"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, Quote, Search, Sparkles } from "lucide-react";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";
import { parseTranscriptToLines } from "@/lib/audit/transcriptParser";

function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="psc-empty">{children}</div>;
}

function metricColor(score: number | null, max: number): string {
  const ratio = max > 0 ? (score ?? 0) / max : 0;
  if (ratio >= 0.8) return "var(--psc-success-ink)";
  if (ratio >= 0.5) return "var(--psc-interview-bar)";
  if (ratio >= 0.4) return "var(--psc-warn-ink)";
  return "var(--psc-danger-ink)";
}

/** The executive audit: overall verdict, scored metrics, strengths, weaknesses, and action items. */
export function MockAuditReport({ rawText }: { rawText: string | null }) {
  const parsed = useMemo(() => parseAuditAnalysis(rawText), [rawText]);
  if (!parsed) return <EmptyNote>The audit report has not been added for this session yet.</EmptyNote>;

  const hasContent = Boolean(
    parsed.overallSummary || parsed.metrics.length || parsed.strengths.length || parsed.weaknesses.length || parsed.actionItems.length,
  );
  if (!hasContent) return <EmptyNote>The audit report has not been added for this session yet.</EmptyNote>;

  return (
    <>
      {(parsed.overallScore != null || parsed.overallSummary) && (
        <div className="psc-report-summary">
          <strong className="psc-inline-label">
            <Sparkles size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            Overall assessment{parsed.overallScore != null ? ` · ${parsed.overallScore} / 10` : ""}
          </strong>
          {parsed.overallSummary && <p>{parsed.overallSummary}</p>}
        </div>
      )}

      {parsed.metrics.length > 0 && (
        <div className="psc-metrics">
          {parsed.metrics.map((metric) => {
            const max = metric.maxScore || 10;
            const width = Math.max(0, Math.min(100, ((metric.score ?? 0) / max) * 100));
            return (
              <div key={metric.name} className="psc-metric">
                <div className="psc-metric-top">
                  <span>{metric.name}</span>
                  <span style={{ color: metricColor(metric.score, max), fontVariantNumeric: "tabular-nums" }}>
                    {metric.score ?? "—"} / {max}
                  </span>
                </div>
                <div className="psc-metric-track" role="img" aria-label={`${metric.name}: ${metric.score ?? "not scored"} of ${max}`}>
                  <div className="psc-metric-fill" style={{ width: `${width}%`, background: metricColor(metric.score, max) }} />
                </div>
                {metric.note && <p className="psc-metric-note">{metric.note}</p>}
              </div>
            );
          })}
        </div>
      )}

      {parsed.strengths.length > 0 && (
        <section className="psc-report-section">
          <h4><CheckCircle2 size={14} />Strengths</h4>
          {parsed.strengths.map((strength) => (
            <div key={strength.title} className="psc-strength">
              <strong>{strength.title}</strong>
              {strength.description && <p>{strength.description}</p>}
            </div>
          ))}
        </section>
      )}

      {parsed.weaknesses.length > 0 && (
        <section className="psc-report-section">
          <h4><AlertTriangle size={14} />Areas to improve</h4>
          {parsed.weaknesses.map((weakness) => (
            <div key={weakness.title} className="psc-weakness">
              <strong>{weakness.title}</strong>
              {weakness.mistake && <p>{weakness.mistake}</p>}
              {weakness.quote && (
                <blockquote>
                  <Quote size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  {weakness.quote}
                </blockquote>
              )}
              {weakness.correction && <p><span className="psc-inline-label">Correction: </span>{weakness.correction}</p>}
            </div>
          ))}
        </section>
      )}

      {parsed.actionItems.length > 0 && (
        <section className="psc-report-section">
          <h4><ListChecks size={14} />Next steps</h4>
          {parsed.actionItems.map((item) => (
            <div key={item.title} className="psc-action-item">
              <strong>{item.title}</strong>
              {item.action && <p>{item.action}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function formatTimestamp(ms: number | null): string | null {
  if (ms == null) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Searchable, speaker-filterable transcript laid out as a conversation. */
export function MockTranscriptViewer({ rawText }: { rawText: string | null }) {
  const [search, setSearch] = useState("");
  const [speaker, setSpeaker] = useState("all");
  const lines = useMemo(() => parseTranscriptToLines(rawText ?? ""), [rawText]);
  const speakers = useMemo(() => Array.from(new Set(lines.map((line) => line.speaker))), [lines]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lines.filter((line) => (speaker === "all" || line.speaker === speaker)
      && (!query || line.text.toLowerCase().includes(query) || line.speaker.toLowerCase().includes(query)));
  }, [lines, search, speaker]);

  if (!rawText?.trim()) return <EmptyNote>No transcript has been added for this session yet.</EmptyNote>;
  // Text that did not match any speaker pattern is shown as written, not dropped.
  if (lines.length === 0) return <pre className="psc-raw-transcript">{rawText}</pre>;

  return (
    <>
      <div className="psc-transcript-controls">
        <label className="psc-transcript-search">
          <Search size={13} aria-hidden="true" color="var(--p-ink-soft)" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transcript" aria-label="Search transcript" />
        </label>
        <button type="button" className={`psc-speaker-chip ${speaker === "all" ? "psc-speaker-chip-active" : ""}`} onClick={() => setSpeaker("all")}>All</button>
        {speakers.map((name) => (
          <button key={name} type="button" className={`psc-speaker-chip ${speaker === name ? "psc-speaker-chip-active" : ""}`} onClick={() => setSpeaker(name)}>
            {name}
          </button>
        ))}
      </div>
      <p className="psc-transcript-meta">Showing {visible.length} of {lines.length} lines</p>
      {visible.length === 0 ? (
        <EmptyNote>No lines match this search.</EmptyNote>
      ) : (
        <div className="psc-bubbles">
          {visible.map((line) => {
            const timestamp = formatTimestamp(line.timestampMs);
            const isCandidate = line.isCandidate;
            return (
              <div key={line.seq} className={`psc-bubble-row ${isCandidate ? "psc-bubble-row-candidate" : ""}`}>
                <div className="psc-bubble">
                  <span
                    className="psc-bubble-avatar"
                    style={{ background: isCandidate ? "var(--p-navy-fill)" : "var(--psc-mock-bar)" }}
                    aria-hidden="true"
                  >
                    {line.speaker.charAt(0).toUpperCase()}
                  </span>
                  <div
                    className="psc-bubble-content"
                    style={{
                      background: isCandidate ? "var(--p-navy-soft)" : "var(--p-bg)",
                      border: `1px solid ${isCandidate ? "transparent" : "var(--p-border)"}`,
                    }}
                  >
                    <div className="psc-bubble-head">
                      <strong>{line.speaker}</strong>
                      {timestamp && <span>{timestamp}</span>}
                    </div>
                    <p>{line.text}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
