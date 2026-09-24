import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute } from "@/server/db/neon";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

export async function PATCH(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const body = await req.json().catch(() => ({}));
    const rawAnalysisText = typeof body?.raw_analysis_text === "string" ? body.raw_analysis_text.trim() : "";
    if (!rawAnalysisText) {
      return NextResponse.json({ error: "raw_analysis_text is required" }, { status: 400 });
    }

    const parsed = parseAuditAnalysis(rawAnalysisText);
    const result = await execute(
      `UPDATE student_audit_mock_sessions SET raw_analysis_text = $1, overall_score = $2, updated_at = now() WHERE id = $3`,
      [rawAnalysisText, parsed?.overallScore ?? null, params.sessionId]
    );
    if (result.rowCount === 0) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("PATCH student-audit mock session analysis error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
