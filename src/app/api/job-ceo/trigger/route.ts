import { NextRequest, NextResponse } from "next/server";
import { startRun, dispatchAndChain } from "@/server/services/jobCeoService";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    let body: { scoutTerms?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      // body optional
    }

    const run = await startRun({
      triggerType: "manual",
      startedBy: (req as any).auth?.userId,
      scoutTerms: body.scoutTerms,
    });

    const baseUrl = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";
    fetch(`${baseUrl}/api/job-ceo/dispatch`, { method: "POST" }).catch(() => {});

    return NextResponse.json({ runId: run.id, status: run.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
