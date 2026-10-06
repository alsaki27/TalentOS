"use client";

import Link from "next/link";
import { ArrowUpRight, ClipboardCheck, FileText, GraduationCap, Target, Trophy, Users } from "lucide-react";
import { formatDateOnly, type PortalMockSessionSummary, type PortalTrainingAudit } from "@/lib/portalSchedule";

interface Props {
  audit: PortalTrainingAudit | null;
  loading: boolean;
  error: string;
}

function scoreTone(score: number, max: number): "high" | "mid" | "low" {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.5) return "mid";
  return "low";
}

function MockSessionCard({ session }: { session: PortalMockSessionSummary }) {
  const max = session.overall_score_max ?? 10;
  return (
    <article className="psc-mock-card">
      <div className="psc-mock-top">
        <div className="psc-mock-top-left">
          <strong>{session.round_type || "Mock interview"}</strong>
          {session.overall_score != null && (
            <span className={`psc-score-pill psc-score-${scoreTone(session.overall_score, max)}`}>
              {session.overall_score} / {max}
            </span>
          )}
          <span className="psc-mock-date">{formatDateOnly(session.session_date.slice(0, 10))}</span>
        </div>
        <Link className="portal-btn portal-btn-secondary portal-btn-small" href={`/portal/interviews/mock/${session.id}`} aria-label={`Open mock interview report: ${session.round_type || "Mock interview"}`}>
          <ArrowUpRight size={13} /> Open
        </Link>
      </div>
      <div className="psc-mock-badges">
        {session.target_role && <span className="psc-mock-badge"><Target size={11} />{session.target_role}</span>}
        {session.evaluator && <span className="psc-mock-badge"><Users size={11} />{session.evaluator}</span>}
        {session.has_audit_report && <span className="psc-mock-badge"><ClipboardCheck size={11} />Audit report</span>}
        {session.has_transcript && <span className="psc-mock-badge"><FileText size={11} />Transcript</span>}
      </div>
      {session.feedback_summary && <p className="psc-mock-feedback">&ldquo;{session.feedback_summary}&rdquo;</p>}
    </article>
  );
}

export default function TrainingAuditTab({ audit, loading, error }: Props) {
  if (loading && !audit) return <div className="portal-skeleton" style={{ height: 240 }} />;
  if (error && !audit) return <p className="portal-error">{error}</p>;

  if (!audit?.linked || !audit.student) {
    return (
      <div className="psc-empty">
        <GraduationCap size={22} style={{ marginBottom: 6 }} />
        <div>Your training audit will appear here once your training record is linked.</div>
      </div>
    );
  }

  const { student, mockSessions, mockInterviewCount } = audit;
  const progress = Math.max(0, Math.min(100, Number(student.progress ?? 0)));
  const placement = student.placement;

  return (
    <div className="psc-training-grid">
      <aside className="psc-profile-card" aria-label="Training profile">
        <h3>Training profile</h3>
        <div className="psc-profile-row"><span>Track</span><strong>{student.domain || student.target_role || "Not set"}</strong></div>
        <div className="psc-profile-row"><span>Target role</span><strong>{student.target_role || "Not set"}</strong></div>
        <div className="psc-profile-row"><span>Mock interviews</span><strong>{mockInterviewCount}</strong></div>
        <div style={{ marginTop: 12 }}>
          <div className="psc-profile-row" style={{ borderBottom: "none", padding: 0 }}>
            <span>Course completion</span><strong>{progress}%</strong>
          </div>
          <div
            className="psc-progress-track"
            role="progressbar"
            aria-label="Course completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="psc-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {placement && (
          <div className="psc-placement">
            <Trophy size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
            Placed{placement.role ? ` as ${placement.role}` : ""}{placement.company ? ` at ${placement.company}` : ""}
            {placement.date ? ` · ${formatDateOnly(placement.date)}` : ""}
          </div>
        )}
      </aside>

      <section aria-label="Mock interview history">
        <h3 className="psc-section-title">Mock interview history ({mockSessions.length})</h3>
        {mockSessions.length === 0 ? (
          <div className="psc-empty">No mock interviews recorded yet.</div>
        ) : (
          <div className="psc-mock-list">
            {mockSessions.map((session) => <MockSessionCard key={session.id} session={session} />)}
          </div>
        )}
      </section>
    </div>
  );
}
