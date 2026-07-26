import { NextRequest, NextResponse } from "next/server";
import { findRunById, updateRunStatus } from "@/server/repositories/jobCeoRunRepository";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";

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

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
