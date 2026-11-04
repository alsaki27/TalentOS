import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, CANDIDATE_JOB_REVIEW_ROLES } from "@/lib/auth";
import { approveReviewItem } from "@/server/services/candidateJobReviewQueueService";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCurrentUser(CANDIDATE_JOB_REVIEW_ROLES);
  if (auth.response) return auth.response;
  try {
    const result = await approveReviewItem(params.id, auth.context.profile.user_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[candidate-job-review] Approve failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not approve this item." }, { status: 400 });
  }
}
