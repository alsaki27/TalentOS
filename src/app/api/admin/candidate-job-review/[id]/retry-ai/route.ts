import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, CANDIDATE_JOB_REVIEW_ROLES } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { retryAiScoring } from "@/server/services/candidateJobReviewQueueService";
import { enqueueExtensionReviewAiRetry, processPendingReviewAi } from "@/server/services/candidateReviewAiService";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCurrentUser(CANDIDATE_JOB_REVIEW_ROLES);
  if (auth.response) return auth.response;
  try {
    const item=await queryOne<{source:string}>("SELECT source FROM candidate_job_review_queue WHERE id=$1",[params.id]);
    if(!item) return NextResponse.json({error:"Review item not found."},{status:404});
    if(item.source==="extension") {
      await enqueueExtensionReviewAiRetry(params.id);
      backgroundDispatch(processPendingReviewAi({ids:[params.id]}));
      return NextResponse.json({ok:true,accepted:true,aiStatus:"pending"},{status:202});
    }
    const config = await queryOne<{ custom_prompt: string; ai_match_threshold: number }>(
      "SELECT custom_prompt, ai_match_threshold FROM scheduled_candidate_logging_config WHERE id = true",
    );
    await retryAiScoring(params.id, config?.custom_prompt ?? "", config?.ai_match_threshold);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[candidate-job-review] Retry AI check failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not retry the AI eligibility check." }, { status: 400 });
  }
}
