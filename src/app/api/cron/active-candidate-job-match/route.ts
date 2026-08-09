import { NextRequest, NextResponse } from "next/server";
import { envFlag } from "@/server/runtimeConfig";
import { runActiveCandidateJobMatcher, type CandidateJobMatcherMode } from "@/server/services/candidateJobMatcherService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest) {
  return Boolean(process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!envFlag("CANDIDATE_JOB_MATCHER_ENABLED", false)) {
    return NextResponse.json({ error: "Candidate job matcher is disabled" }, { status: 503 });
  }
  const invocation = req.headers.get("x-candidate-match-invocation")?.toLowerCase();
  const triggerType = invocation === "scheduled" ? "scheduled" : invocation === "recovery" ? "recovery" : "manual";
  let mode: CandidateJobMatcherMode = "dry_run";
  if (triggerType === "scheduled") {
    mode = process.env.CANDIDATE_JOB_MATCHER_MODE === "ae_review" ? "ae_review" : "dry_run";
  } else {
    const body = await req.json().catch(() => ({})) as { mode?: unknown; runKey?: unknown };
    if (body.mode === "ae_review" && req.headers.get("x-candidate-match-live-confirmation") === "AE_REVIEW") mode = "ae_review";
    const run = await runActiveCandidateJobMatcher({
      mode, triggerType, runKey: typeof body.runKey === "string" ? body.runKey : undefined,
    });
    return NextResponse.json({ ok: true, run });
  }
  const run = await runActiveCandidateJobMatcher({ mode, triggerType });
  return NextResponse.json({ ok: true, run });
}
