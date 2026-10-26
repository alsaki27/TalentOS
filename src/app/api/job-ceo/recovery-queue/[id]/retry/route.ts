import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { retryRecoveryQueueRowById } from "@/server/services/jobCeoRecoveryRetryService";

export const dynamic = "force-dynamic";

/**
 * Staff-triggered "Retry Now" — re-attempts the fetch for exactly one
 * recovery-queue row right now, bypassing the scheduled batch's backoff
 * timer (a deliberate click overrides the wait, same as any other
 * staff-initiated retry elsewhere in this app). Still records the attempt
 * (recovery_retry_count / recovery_last_retried_at) so the queue stays
 * honest about how many times this job has actually been tried.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const result = await retryRecoveryQueueRowById(params.id);
    if (result.outcome === "ineligible") {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
