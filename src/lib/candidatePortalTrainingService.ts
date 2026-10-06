import { query, queryOne } from "@/server/db/neon";
import { ensureLinked } from "@/server/services/studentAuditLink";
import type { PortalMockSessionDetail, PortalMockSessionSummary, PortalTrainingAudit } from "@/lib/portalSchedule";

// Candidate-facing read model for the training audit. Deliberately excluded
// from every response: the internal mentor observation trail (sticky notes),
// the staff rating, stored PDFs and their storage URLs. Audit reports and
// transcripts are returned only by getCandidatePortalMockSession, for one
// session that belongs to the signed-in candidate.

interface SessionRow {
  id: string;
  session_date: string;
  target_role: string | null;
  round_type: string | null;
  evaluator: string | null;
  overall_score: number | string | null;
  overall_score_max: number | string | null;
  feedback_summary: string | null;
  strengths_noted: string | null;
  areas_for_improvement: string | null;
  has_audit_report: boolean;
  has_transcript: boolean;
}

interface DetailRow extends SessionRow {
  raw_analysis_text: string | null;
  transcript_raw_text: string | null;
}

interface StudentRow {
  id: string;
  domain: string | null;
  target_role: string | null;
  progress: number | string | null;
  mock_interviews: number | string | null;
  synced_at: string | null;
  placement_company: string | null;
  placement_role: string | null;
  placement_date: string | Date | null;
}

const SESSION_COLUMNS = `
  m.id, m.session_date, m.target_role, m.round_type, m.created_by AS evaluator,
  m.overall_score, m.overall_score_max, m.feedback_summary, m.strengths_noted, m.areas_for_improvement,
  (NULLIF(BTRIM(m.raw_analysis_text), '') IS NOT NULL) AS has_audit_report,
  (NULLIF(BTRIM(m.transcript_raw_text), '') IS NOT NULL) AS has_transcript`;

function toNumberOrNull(value: number | string | null): number | null {
  return value == null ? null : Number(value);
}

function toDateKey(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function toSummary(row: SessionRow): PortalMockSessionSummary {
  return {
    id: row.id,
    session_date: row.session_date,
    target_role: row.target_role,
    round_type: row.round_type,
    evaluator: row.evaluator,
    overall_score: toNumberOrNull(row.overall_score),
    overall_score_max: toNumberOrNull(row.overall_score_max),
    feedback_summary: row.feedback_summary,
    strengths_noted: row.strengths_noted,
    areas_for_improvement: row.areas_for_improvement,
    has_audit_report: Boolean(row.has_audit_report),
    has_transcript: Boolean(row.has_transcript),
  };
}

export async function getCandidatePortalTrainingAudit(candidateId: string): Promise<PortalTrainingAudit> {
  const auditStudentId = await ensureLinked(candidateId);
  const student = await queryOne<StudentRow>(
    `SELECT s.id, s.domain, s.target_role, s.progress, s.mock_interviews, s.synced_at,
            s.placement_company, s.placement_role, s.placement_date
     FROM student_audit_students s
     WHERE s.id = $1
     LIMIT 1`,
    [auditStudentId],
  );

  if (!student) {
    return { linked: false, student: null, mockInterviewCount: 0, mockSessions: [] };
  }

  const [sessions, countRow] = await Promise.all([
    query<SessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM student_audit_mock_sessions m
       WHERE m.student_id = $1
       ORDER BY m.session_date DESC, m.id DESC
       LIMIT 100`,
      [student.id],
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM student_audit_mock_sessions WHERE student_id = $1`,
      [student.id],
    ),
  ]);

  const sessionCount = Number(countRow?.count ?? 0);
  const placementDate = toDateKey(student.placement_date);
  const hasPlacement = Boolean(student.placement_company || student.placement_role || placementDate);

  return {
    linked: true,
    student: {
      domain: student.domain,
      target_role: student.target_role,
      progress: Number(student.progress ?? 0),
      synced_at: student.synced_at,
      placement: hasPlacement
        ? { company: student.placement_company, role: student.placement_role, date: placementDate }
        : null,
    },
    mockInterviewCount: sessionCount > 0 ? sessionCount : Number(student.mock_interviews ?? 0),
    mockSessions: sessions.map(toSummary),
  };
}

/**
 * One mock interview with its audit report and transcript. Returns null unless
 * the session belongs to the candidate's own linked training record, so another
 * candidate's session id cannot be read by guessing it.
 */
export async function getCandidatePortalMockSession(candidateId: string, sessionId: string): Promise<PortalMockSessionDetail | null> {
  const link = await queryOne<{ audit_student_id: string }>(
    `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
    [candidateId],
  );
  if (!link) return null;

  const row = await queryOne<DetailRow>(
    `SELECT ${SESSION_COLUMNS}, m.raw_analysis_text, m.transcript_raw_text
     FROM student_audit_mock_sessions m
     WHERE m.id = $1 AND m.student_id = $2`,
    [sessionId, link.audit_student_id],
  );
  if (!row) return null;

  return {
    ...toSummary(row),
    raw_analysis_text: row.raw_analysis_text,
    transcript_raw_text: row.transcript_raw_text,
  };
}
