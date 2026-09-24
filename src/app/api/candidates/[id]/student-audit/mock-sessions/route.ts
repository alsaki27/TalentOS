import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import { parseAndOrganizeTranscript } from "@/lib/audit/transcriptParser";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const link = await queryOne<{ audit_student_id: string }>(
      `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) return NextResponse.json({ sessions: [] });

    const sessions = await query(
      `SELECT id, session_date, target_role, transcript_source, overall_score, overall_score_max, raw_analysis_text
       FROM student_audit_mock_sessions WHERE student_id = $1 ORDER BY session_date DESC, id DESC`,
      [link.audit_student_id]
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
    const link = await queryOne<{ audit_student_id: string }>(
      `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) {
      return NextResponse.json({ error: "No student-audit record linked to this candidate" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const sessionDate = typeof body?.session_date === "string" && body.session_date ? body.session_date : new Date().toISOString().slice(0, 10);
    const targetRole = typeof body?.target_role === "string" ? body.target_role.trim() || null : null;
    const transcriptSource = typeof body?.transcript_source === "string" ? body.transcript_source : "teams";
    const transcriptRawText = typeof body?.transcript_raw_text === "string" ? body.transcript_raw_text.trim() : "";
    const analysisRawText = typeof body?.analysis_raw_text === "string" ? body.analysis_raw_text.trim() : "";

    if (!transcriptRawText && !analysisRawText) {
      return NextResponse.json({ error: "Provide a transcript and/or an audit analysis" }, { status: 400 });
    }

    const organizedTranscript = transcriptRawText ? parseAndOrganizeTranscript(transcriptRawText) : null;
    const parsedAnalysis = analysisRawText ? parseAuditAnalysis(analysisRawText) : null;

    const id = `mock-${Date.now()}`;
    const createdBy = context?.profile.display_name || context?.profile.email || "TalentOS";

    const session = await queryOne(
      `INSERT INTO student_audit_mock_sessions (
         id, student_id, session_date, target_role, transcript_source,
         transcript_raw_text, raw_analysis_text, overall_score, overall_score_max, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, session_date, target_role, transcript_source, overall_score, overall_score_max, raw_analysis_text`,
      [
        id,
        link.audit_student_id,
        sessionDate,
        targetRole,
        transcriptSource,
        organizedTranscript,
        analysisRawText || null,
        parsedAnalysis?.overallScore ?? null,
        10,
        createdBy,
      ]
    );

    // Keep the manual mock_interviews counter roughly in step for any code
    // path that still reads it directly (the API's GET already prefers the
    // real session count once sessions exist).
    await execute(
      `UPDATE student_audit_students SET mock_interviews = (
         SELECT COUNT(*)::int FROM student_audit_mock_sessions WHERE student_id = $1
       ) WHERE id = $1`,
      [link.audit_student_id]
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (err: any) {
    console.error("POST student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
