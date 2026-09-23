import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { envFlag } from "@/server/runtimeConfig";
import { runActiveCandidateJobMatcher } from "@/server/services/candidateJobMatcherService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!envFlag("CANDIDATE_JOB_MATCHER_ENABLED", false)) {
    return NextResponse.json({ error: "Candidate job matcher is disabled" }, { status: 503 });
  }

  try {
    const run = await runActiveCandidateJobMatcher({
      mode: "ae_review",
      triggerType: "manual",
      actorUserId: context!.profile.user_id,
    });
    return NextResponse.json({ ok: true, run });
  } catch (error: any) {
    console.error("[Force Run Matcher API] Error:", error);
    return NextResponse.json({ error: "Failed to run candidate job matcher", details: error.message }, { status: 500 });
  }
}
