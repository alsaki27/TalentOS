// Full staging-row dump for a run — every job that made it through ingest,
// regardless of whether it hit Matchmaker's ≥90% bar and got logged into
// `jobs`. runs/[id] only returns aggregate counts by stage; this is the
// endpoint an export (CSV/Excel) should actually pull from, since "all the
// jobs we found" is a much bigger set than "jobs that got logged."
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findRunById } from "@/server/repositories/jobCeoRunRepository";
import { listStagedByRun } from "@/server/repositories/jobCeoStagingRepository";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(["admin", "manager"]);
  if (response) return response;

  const run = await findRunById(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const rows = await listStagedByRun(params.id);
  return NextResponse.json({ run, count: rows.length, jobs: rows });
}
