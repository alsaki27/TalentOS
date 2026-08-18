import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findAuditStudentByCandidateId, createMockSession, addTranscript, upsertAuditReport } from "@/server/db/auditBridge";
import { parseTranscriptToLines } from "@/lib/audit/transcriptParser";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const student = await findAuditStudentByCandidateId(params.id);
    if (!student) {
      return NextResponse.json({ error: "No audit record linked to this candidate yet" }, { status: 404 });
    }

    const body = await req.json();
    const createdBy = context!.profile.display_name;

    const parsed = body.analysis_raw_text?.trim() ? parseAuditAnalysis(body.analysis_raw_text) : null;

    const session = await createMockSession({
      student_id: student.id,
      session_date: body.session_date ?? new Date().toISOString().slice(0, 10),
      target_role: body.target_role ?? parsed?.targetRole ?? null,
      overall_score: parsed?.overallScore ?? null,
      overall_score_max: parsed?.overallScore !== null ? 10 : null,
      summary: parsed?.overallSummary ?? null,
      raw_analysis_text: body.analysis_raw_text ?? null,
      created_by: createdBy,
    });

    if (body.transcript_raw_text?.trim()) {
      const lines = parseTranscriptToLines(body.transcript_raw_text);
      await addTranscript(session.id, {
        source: body.transcript_source ?? "other",
        raw_text: body.transcript_raw_text,
        lines: lines.map((l) => ({
          seq: l.seq,
          speaker: l.speaker,
          is_candidate: l.isCandidate,
          timestamp_ms: l.timestampMs,
          text: l.text,
        })),
      });
    }

    let report = null;
    if (parsed) {
      report = await upsertAuditReport(session.id, {
        metrics: parsed.metrics,
        strengths: parsed.strengths,
        weaknesses: parsed.weaknesses,
        action_items: parsed.actionItems,
      });
    }

    return NextResponse.json({ session, report });
  } catch (err: any) {
    console.error("POST candidate audit mock session error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
