import { NextRequest, NextResponse } from "next/server";
import { findRunById } from "@/server/repositories/jobCeoRunRepository";
import { countByStage } from "@/server/repositories/jobCeoStagingRepository";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
