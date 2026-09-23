import { NextRequest, NextResponse } from "next/server";
import { findRunById, updateRunStatus } from "@/server/repositories/jobCeoRunRepository";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const run = await findRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return NextResponse.json({ error: "Run already finished" }, { status: 400 });
    }

    await updateRunStatus(params.id, "cancelled", { last_error: "Cancelled by user" });

    // Clean up dedup signatures recorded during this run so the next run
    // doesn't incorrectly skip these jobs as duplicates.
    await execute(
      "DELETE FROM job_ceo_seen_signatures WHERE run_id = $1",
      [params.id]
    ).catch((err) => {
      // Non-fatal: log but don't fail the cancellation
      console.error("[Job CEO] Cancel: failed to clean up dedup signatures:", err);
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
