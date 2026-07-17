import { NextRequest, NextResponse } from "next/server";
import { startRun } from "@/server/services/jobCeoService";
import { requireCurrentUser } from "@/lib/auth";
import { backgroundDispatch } from "@/server/lib/waitUntil";

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

    // Registered with ctx.waitUntil via backgroundDispatch so it survives
    // past this response instead of racing it - a plain un-awaited fetch
    // here was confirmed (on the resume-agent pipeline this mirrors) to get
    // killed before the dispatch endpoint's invocation ever ran.
    const baseUrl = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";
    await backgroundDispatch(
      fetch(`${baseUrl}/api/job-ceo/dispatch`, { method: "POST" }).catch((err) => {
        console.error("[Job CEO] Trigger dispatch self-fetch failed:", err);
      })
    );

    return NextResponse.json({ runId: run.id, status: run.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
