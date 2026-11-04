import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { enqueueScheduledCandidateLogging, continueScheduledCandidateLogging } from "@/server/services/scheduledCandidateLoggingService";
import { scheduledLoggingDay } from "@/lib/scheduledLoggingSchedule";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedTrigger = request.headers.get("x-scheduled-logging-trigger");
  try {
    // Minute ticks resume existing work before considering today's daily batch.
    // This is the catch-up path if the exact 05:00 trigger is delayed or missed.
    if (requestedTrigger === "tick" || requestedTrigger === "daily") {
      const continued = await continueScheduledCandidateLogging();
      if (!("skipped" in continued)) return NextResponse.json({ok:true,result:continued});
      const schedule = scheduledLoggingDay();
      if (!schedule.due) return NextResponse.json({ok:true,result:continued});
      const accepted = await enqueueScheduledCandidateLogging({triggerType:"scheduled",runKey:`scheduled-candidate-logging:daily:${schedule.day}`});
      if ("skipped" in accepted || accepted.status !== "running") return NextResponse.json({ok:true,result:accepted});
      return NextResponse.json({ok:true,result:await continueScheduledCandidateLogging()});
    }
    const day=scheduledLoggingDay().day;
    const requestId=request.headers.get("x-scheduled-logging-request-id");
    const idempotencyId=requestId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? requestId : randomUUID();
    const result=await enqueueScheduledCandidateLogging({
      triggerType:requestedTrigger === "manual"?"manual":"scheduled",
      runKey:requestedTrigger === "manual"?`scheduled-candidate-logging:workflow-dispatch:${idempotencyId}`:`scheduled-candidate-logging:daily:${day}`,
    });
    return NextResponse.json({ok:true,accepted:true,result},{status:202});
  } catch (error) {
    console.error("[Scheduled candidate logging] Cron run failed:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Scheduled candidate logging failed.",
    }, { status: 500 });
  }
}
