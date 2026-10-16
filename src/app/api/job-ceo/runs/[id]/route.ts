import { NextRequest, NextResponse } from "next/server";
import { findRunById, deleteRun } from "@/server/repositories/jobCeoRunRepository";
import { countByStage } from "@/server/repositories/jobCeoStagingRepository";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // The middleware permits CRON_SECRET for this read-only endpoint so the
  // Adzuna workflow can poll without a browser session. Re-check machine
  // credentials here as defense in depth; session-authenticated staff requests
  // without an Authorization header continue through middleware as before.
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const run = await findRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const stages = await countByStage(params.id);
    const needsDispatch = run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled";

    return NextResponse.json({ run, stages, needsDispatch });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const run = await findRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    // Safety guard: never delete an in-progress run
    const activeStatuses = ["ingesting", "qa", "deep_fetch", "matchmaking"];
    if (activeStatuses.includes(run.status)) {
      return NextResponse.json(
        { error: "Cannot delete an active run. Cancel it first." },
        { status: 409 }
      );
    }
    await deleteRun(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
