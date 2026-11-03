import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { retryAiScoring } from "@/server/services/candidateJobReviewQueueService";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (auth.response) return auth.response;
  try {
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
