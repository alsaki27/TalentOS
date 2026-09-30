import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { query, queryOne } from "@/server/db/neon";
import { ensureLinked } from "@/server/services/studentAuditLink";

export const dynamic = "force-dynamic";

/** Candidate-safe summary of the signed-in candidate's own training audit. */
export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const auditStudentId = await ensureLinked(context.candidateId);
  const student = await queryOne<{
    id: string;
    domain: string | null;
    target_role: string | null;
    progress: number;
    mock_interviews: number;
    synced_at: string | null;
  }>(
    `SELECT s.id, s.domain, s.target_role, s.progress, s.mock_interviews, s.synced_at
     FROM student_audit_students s
     WHERE s.id = $1
     LIMIT 1`,
    [auditStudentId],
  );

  if (!student) {
    return NextResponse.json({ linked: false, student: null, mockInterviewCount: 0, mockSessions: [] });
  }

  // Keep transcripts, staff notes, raw AI analysis, and stored PDFs off the
  // candidate-facing response. This list contains only session facts and scores.
  const [mockSessions, sessionCount] = await Promise.all([query<{
    id: string;
    session_date: string;
    target_role: string | null;
    round_type: string | null;
    overall_score: number | null;
    overall_score_max: number | null;
    feedback_summary: string | null;
    strengths_noted: string | null;
    areas_for_improvement: string | null;
  }>(
    `SELECT id, session_date, target_role, round_type, overall_score, overall_score_max,
            feedback_summary, strengths_noted, areas_for_improvement
     FROM student_audit_mock_sessions
     WHERE student_id = $1
     ORDER BY session_date DESC, id DESC
     LIMIT 100`,
    [student.id],
  ), queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM student_audit_mock_sessions WHERE student_id = $1`,
    [student.id],
  )]);

  return NextResponse.json({
    linked: true,
    student: {
      domain: student.domain,
      target_role: student.target_role,
      progress: Number(student.progress ?? 0),
      synced_at: student.synced_at,
    },
    mockInterviewCount: Number(sessionCount?.count ?? 0) > 0 ? Number(sessionCount?.count) : Number(student.mock_interviews ?? 0),
    mockSessions: mockSessions.map((session) => ({
      ...session,
      overall_score: session.overall_score == null ? null : Number(session.overall_score),
      overall_score_max: session.overall_score_max == null ? null : Number(session.overall_score_max),
    })),
  });
}
