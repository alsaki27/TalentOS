import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { upsertAuditReport } from "@/server/db/auditBridge";
import { parseAuditAnalysis } from "@/lib/audit/auditAnalysisParser";

export async function PATCH(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const { raw_analysis_text } = await req.json();
    const parsed = parseAuditAnalysis(raw_analysis_text);
    if (!parsed) {
      return NextResponse.json({ error: "Could not parse analysis text" }, { status: 400 });
    }

    const report = await upsertAuditReport(params.sessionId, {
      metrics: parsed.metrics,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      action_items: parsed.actionItems,
    });
    return NextResponse.json({ report, parsed });
  } catch (err: any) {
    console.error("PATCH candidate audit analysis error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
