import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listRecoveryQueue, countRecoveryQueue } from "@/server/repositories/jobCeoStagingRepository";

export const dynamic = "force-dynamic";

// Lists every job stuck at stage='no_description' across every run — the
// Adzuna (and generically any source's) description-recovery queue. See
// "Adzuna Job CEO Coverage and Description Recovery Plan" (2026-10-25),
// Phase 1. Staff review this as one standing worklist and export it to CSV
// from the client, the same way src/app/jobs/page.tsx's "Export CSV" does.
export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const limit = Math.min(1000, parseInt(url.searchParams.get("limit") || "500", 10));
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  try {
    const [rows, total] = await Promise.all([
      listRecoveryQueue(limit, offset),
      countRecoveryQueue(),
    ]);
    return NextResponse.json({ rows, total, limit, offset });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "Could not load the recovery queue" }, { status: 500 });
  }
}
