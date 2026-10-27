import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { retryManyRowsByIds } from "@/server/services/jobCeoRecoveryRetryService";

export const dynamic = "force-dynamic";

/**
 * Staff-picked bulk retry: a set of recovery-queue rows selected by hand on
 * the page (checkboxes, or "select all" within a source filter) retried
 * together in one click — same per-row Retry Now behavior, just for several
 * rows at once instead of one at a time.
 */
export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: { ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.trim()) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array of staging row IDs" }, { status: 400 });
  }

  try {
    const summary = await retryManyRowsByIds(ids);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
