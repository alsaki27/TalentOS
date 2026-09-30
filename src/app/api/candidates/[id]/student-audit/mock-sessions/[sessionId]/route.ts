import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { parseAndOrganizeTranscript } from "@/lib/audit/transcriptParser";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";
import { deleteResumeFile } from "@/lib/resumeStorage";

const SESSION_COLUMNS = `
  id, session_date, target_role, transcript_source, transcript_raw_text,
  raw_analysis_text, overall_score, overall_score_max, round_type,
  feedback_summary, strengths_noted, areas_for_improvement, pdf_url, pdf_filename, created_by
`;

export async function GET(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne(
      `SELECT ${SESSION_COLUMNS} FROM student_audit_mock_sessions WHERE id = $1`,
      [params.sessionId]
    );
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err: any) {
    console.error("GET student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * Full edit of an existing session — matches skarion-student-audit's
 * "Edit Mock Interview Record" exactly: every field can change, and unlike
 * create, no sticky note is added or touched.
 */
export async function PUT(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const body = await req.json().catch(() => ({}));
    const feedback = typeof body?.feedback_summary === "string" ? body.feedback_summary.trim() : "";
    if (!feedback) {
      return NextResponse.json({ error: "Detailed feedback is required" }, { status: 400 });
    }

    const sessionDate = typeof body?.session_date === "string" && body.session_date ? body.session_date : undefined;
    const evaluator = typeof body?.created_by === "string" && body.created_by ? body.created_by : undefined;
    const roundType = typeof body?.round_type === "string" && body.round_type ? body.round_type : "Overall";
    const strengths = typeof body?.strengths_noted === "string" ? body.strengths_noted.trim() : "";
    const improvement = typeof body?.areas_for_improvement === "string" ? body.areas_for_improvement.trim() : "";
    const transcriptRawText = typeof body?.transcript_raw_text === "string" ? body.transcript_raw_text.trim() : "";
    const analysisRawText = typeof body?.analysis_raw_text === "string" ? body.analysis_raw_text.trim() : "";
    const manualScore = body?.overall_score !== undefined && body?.overall_score !== null ? Number(body.overall_score) : null;

    const organizedTranscript = transcriptRawText ? parseAndOrganizeTranscript(transcriptRawText) : null;
    const parsedAnalysis = analysisRawText ? parseAuditAnalysis(analysisRawText) : null;
    const overallScore = parsedAnalysis?.overallScore ?? manualScore;

    const existing = await queryOne<{ session_date: string; created_by: string | null }>(
      `SELECT session_date, created_by FROM student_audit_mock_sessions WHERE id = $1`,
      [params.sessionId]
    );
    if (!existing) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const updated = await queryOne(
      `UPDATE student_audit_mock_sessions SET
         session_date = $1, transcript_raw_text = $2, raw_analysis_text = $3,
         overall_score = $4, round_type = $5, feedback_summary = $6,
         strengths_noted = $7, areas_for_improvement = $8, created_by = $9,
         updated_at = now()
       WHERE id = $10
       RETURNING ${SESSION_COLUMNS}`,
      [
        sessionDate ?? existing.session_date,
        organizedTranscript,
        analysisRawText || null,
        overallScore,
        roundType,
        feedback,
        strengths || null,
        improvement || null,
        evaluator ?? existing.created_by,
        params.sessionId,
      ]
    );
    return NextResponse.json({ session: updated });
  } catch (err: any) {
    console.error("PUT student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne<{ student_id: string; pdf_url: string | null }>(
      `DELETE FROM student_audit_mock_sessions WHERE id = $1 RETURNING student_id, pdf_url`,
      [params.sessionId]
    );
    if (session?.pdf_url) {
      await deleteResumeFile(session.pdf_url).catch(() => {});
    }
    if (session) {
      await execute(
        `UPDATE student_audit_students SET mock_interviews = (
           SELECT COUNT(*)::int FROM student_audit_mock_sessions WHERE student_id = $1
         ) WHERE id = $1`,
        [session.student_id]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
