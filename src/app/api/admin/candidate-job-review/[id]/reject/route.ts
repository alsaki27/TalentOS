import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, CANDIDATE_JOB_REVIEW_ROLES } from "@/lib/auth";
import { rejectReviewItem } from "@/server/services/candidateJobReviewQueueService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCurrentUser(CANDIDATE_JOB_REVIEW_ROLES);
  if (auth.response) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note : null;
    await rejectReviewItem(params.id, auth.context.profile.user_id, note);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[candidate-job-review] Reject failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reject this item." }, { status: 400 });
  }
}
