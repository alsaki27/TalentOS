import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import { parseAndOrganizeTranscript } from "@/lib/audit/transcriptParser";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";
import { ensureLinked } from "@/server/services/studentAuditLink";

const SESSION_COLUMNS = `
  id, session_date, target_role, transcript_source, transcript_raw_text,
  raw_analysis_text, overall_score, overall_score_max, round_type,
  feedback_summary, strengths_noted, areas_for_improvement, pdf_url, pdf_filename
`;

/** Score color thresholds ported verbatim from skarion-student-audit's getScoreColor(). */
function accentForScore(score: number | null): string {
  if (score === null) return "navy";
  if (score >= 8) return "green";
  if (score >= 5) return "blue";
  return "amber";
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const auditStudentId = await ensureLinked(params.id);
    const sessions = await query(
      `SELECT ${SESSION_COLUMNS} FROM student_audit_mock_sessions WHERE student_id = $1 ORDER BY session_date DESC, id DESC`,
      [auditStudentId]
    );
    return NextResponse.json({ sessions });
  } catch (err: any) {
    console.error("GET student-audit mock sessions error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const auditStudentId = await ensureLinked(params.id);

    const body = await req.json().catch(() => ({}));
    const feedback = typeof body?.feedback_summary === "string" ? body.feedback_summary.trim() : "";
    if (!feedback) {
      return NextResponse.json({ error: "Detailed feedback is required" }, { status: 400 });
    }

    const sessionDate = typeof body?.session_date === "string" && body.session_date ? body.session_date : new Date().toISOString().slice(0, 10);
    const evaluator = typeof body?.created_by === "string" && body.created_by ? body.created_by : (context?.profile.display_name || context?.profile.email || "TalentOS");
    const roundType = typeof body?.round_type === "string" && body.round_type ? body.round_type : "Overall";
    const strengths = typeof body?.strengths_noted === "string" ? body.strengths_noted.trim() : "";
    const improvement = typeof body?.areas_for_improvement === "string" ? body.areas_for_improvement.trim() : "";
    const transcriptRawText = typeof body?.transcript_raw_text === "string" ? body.transcript_raw_text.trim() : "";
    const analysisRawText = typeof body?.analysis_raw_text === "string" ? body.analysis_raw_text.trim() : "";
    const manualScore = body?.overall_score !== undefined && body?.overall_score !== null ? Number(body.overall_score) : null;

    const organizedTranscript = transcriptRawText ? parseAndOrganizeTranscript(transcriptRawText) : null;
    const parsedAnalysis = analysisRawText ? parseAuditAnalysis(analysisRawText) : null;
    // A pasted analysis blob's own parsed score wins (it's the more authoritative
    // source when provided); otherwise fall back to the manual slider value.
    const overallScore = parsedAnalysis?.overallScore ?? manualScore;

    const id = `mock-${Date.now()}`;

    const session = await queryOne(
      `INSERT INTO student_audit_mock_sessions (
         id, student_id, session_date, transcript_source,
         transcript_raw_text, raw_analysis_text, overall_score, overall_score_max,
         round_type, feedback_summary, strengths_noted, areas_for_improvement, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SESSION_COLUMNS}`,
      [
        id,
        auditStudentId,
        sessionDate,
        typeof body?.transcript_source === "string" ? body.transcript_source : "teams",
        organizedTranscript,
        analysisRawText || null,
        overallScore,
        10,
        roundType,
        feedback,
        strengths || null,
        improvement || null,
        evaluator,
      ]
    );

    // Matches skarion-student-audit's create-only behavior exactly: a new
    // session auto-appends a pinned "Mock Feedback" sticky note; editing a
    // session never touches this.
    const noteId = `note-mock-${Date.now()}`;
    const scoreLabel = overallScore !== null ? `${overallScore}/10` : "not scored";
    await execute(
      `INSERT INTO student_audit_sticky_notes (id, student_id, date, content, category, author, accent, pinned)
       VALUES ($1, $2, $3, $4, 'Mock Feedback', $5, $6, true)`,
      [noteId, auditStudentId, sessionDate, `Mock Interview (${roundType}): Scored ${scoreLabel}. ${feedback}`, evaluator, accentForScore(overallScore)]
    );

    // The real session count is the source of truth once any session exists
    // (see the GET summary route's effectiveMockInterviews rule).
    await execute(
      `UPDATE student_audit_students SET mock_interviews = (
         SELECT COUNT(*)::int FROM student_audit_mock_sessions WHERE student_id = $1
       ) WHERE id = $1`,
      [auditStudentId]
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (err: any) {
    console.error("POST student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
