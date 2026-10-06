"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ClipboardCheck, FileText, GraduationCap, ThumbsUp, TrendingUp } from "lucide-react";
import { formatDateOnly, formatDayHeading, type PortalMockSessionDetail } from "@/lib/portalSchedule";
import { MockAuditReport, MockTranscriptViewer } from "./MockReportSections";

function scoreColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return "var(--psc-success-ink)";
  if (ratio >= 0.5) return "var(--psc-interview-bar)";
  return "var(--psc-danger-ink)";
}

function SectionCard({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id: string }) {
  return (
    <section className="portal-card" style={{ padding: 20 }} aria-labelledby={id}>
      <div className="portal-section-heading" style={{ marginBottom: 14 }}>
        <h2 id={id} className="portal-section-heading-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}{title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Full view of one mock interview: result, feedback, the audit report, and the transcript. */
export default function CandidatePortalMockInterviewDetail({ session }: { session: PortalMockSessionDetail }) {
  const max = session.overall_score_max ?? 10;
  const dateKey = session.session_date.slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Link className="portal-back-link" href="/portal/interviews?tab=training">
        <ArrowLeft size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Back to training audit
      </Link>

      <section className="portal-card" style={{ padding: 22 }} aria-label="Mock interview summary">
        <div className="psc-mock-hero">
          <div>
            <div className="portal-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <GraduationCap size={13} /> Mock interview
            </div>
            <h1 className="portal-section-heading-title" style={{ margin: "4px 0 4px" }}>{session.round_type || "Mock interview"}</h1>
            <p className="portal-greeting-sub" style={{ margin: 0 }}>
              {formatDayHeading(dateKey)}{session.target_role ? ` · ${session.target_role}` : ""}
            </p>
          </div>
          {session.overall_score != null && (
            <div className="psc-mock-score-block" aria-label={`Score ${session.overall_score} out of ${max}`}>
              <strong style={{ color: scoreColor(session.overall_score, max) }}>{session.overall_score}</strong>
              <span>out of {max}</span>
            </div>
          )}
        </div>
        <dl className="psc-mock-facts">
          <div><dt>Date</dt><dd>{formatDateOnly(dateKey)}</dd></div>
          <div><dt>Evaluator</dt><dd>{session.evaluator || "Not recorded"}</dd></div>
          <div><dt>Target role</dt><dd>{session.target_role || "Not recorded"}</dd></div>
          <div><dt>Round type</dt><dd>{session.round_type || "Not recorded"}</dd></div>
        </dl>
      </section>

      {(session.feedback_summary || session.strengths_noted || session.areas_for_improvement) && (
        <SectionCard id="mock-feedback" title="Feedback" icon={<FileText size={16} />}>
          {session.feedback_summary && (
            <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6, color: "var(--p-ink)", whiteSpace: "pre-wrap" }}>
              {session.feedback_summary}
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {session.strengths_noted && (
              <div className="psc-strength">
                <strong><ThumbsUp size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Strengths</strong>
                <p>{session.strengths_noted}</p>
              </div>
            )}
            {session.areas_for_improvement && (
              <div className="psc-weakness">
                <strong><TrendingUp size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Areas to improve</strong>
                <p>{session.areas_for_improvement}</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard id="mock-audit" title="Audit report" icon={<ClipboardCheck size={16} />}>
        <MockAuditReport rawText={session.raw_analysis_text} />
      </SectionCard>

      <SectionCard id="mock-transcript" title="Transcript" icon={<FileText size={16} />}>
        <MockTranscriptViewer rawText={session.transcript_raw_text} />
      </SectionCard>
    </div>
  );
}
