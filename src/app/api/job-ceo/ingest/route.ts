import { NextRequest, NextResponse } from "next/server";
import { insertStaged } from "@/server/repositories/jobCeoStagingRepository";
import { createRun, bumpRunCounts } from "@/server/repositories/jobCeoRunRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Fails closed: this endpoint accepts externally-sourced job data (the
  // OpenJobData GitHub Actions runner), so a missing secret must reject
  // every caller, not silently accept them. The prior `if (secret && ...)`
  // check skipped auth entirely whenever JOB_CEO_INGEST_SECRET wasn't
  // configured yet - exactly the state before an operator has set it.
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { runId?: string; jobs?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobs = body.jobs ?? [];
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json({ error: "jobs array is required" }, { status: 400 });
  }

  try {
    let runId = body.runId;
    if (!runId) {
      const run = await createRun({ triggerType: "cron" });
      runId = run.id;
    }

    const staged = await insertStaged(runId, jobs as any[]);
    await bumpRunCounts(runId, { ingested_count: staged });

    const baseUrl = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";
    fetch(`${baseUrl}/api/job-ceo/dispatch`, { method: "POST" }).catch(() => {});

    return NextResponse.json({ runId, staged });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
