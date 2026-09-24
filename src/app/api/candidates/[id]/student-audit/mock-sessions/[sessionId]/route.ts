import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne(
      `SELECT id, session_date, target_role, transcript_source, transcript_raw_text,
              raw_analysis_text, overall_score, overall_score_max
       FROM student_audit_mock_sessions WHERE id = $1`,
      [params.sessionId]
    );
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err: any) {
    console.error("GET student-audit mock session error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne<{ student_id: string }>(
      `DELETE FROM student_audit_mock_sessions WHERE id = $1 RETURNING student_id`,
      [params.sessionId]
    );
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
