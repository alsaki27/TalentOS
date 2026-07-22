import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listStagedByRun, countStagedByRunAndStage } from "@/server/repositories/jobCeoStagingRepository";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") || undefined;
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") || "200", 10));
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  try {
    const [rows, counts] = await Promise.all([
      listStagedByRun(params.id, stage, limit, offset),
      countStagedByRunAndStage(params.id),
    ]);
    return NextResponse.json({ rows, counts, limit, offset });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load staging data" }, { status: 500 });
  }
}
