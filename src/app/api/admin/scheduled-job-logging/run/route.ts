import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { hasScheduledLoggingSession } from "@/server/security/scheduledCandidateLoggingAuth";
import { runScheduledCandidateLogging } from "@/server/services/scheduledCandidateLoggingService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_request: NextRequest) {
  const auth = await requireCurrentUser(["admin"]);
  if (auth.response) return auth.response;
  if (!(await hasScheduledLoggingSession(auth.context.profile.user_id))) {
    return NextResponse.json({ error: "Unlock the scheduled logging page first." }, { status: 423 });
  }

  try {
    const config = await queryOne<{ is_enabled: boolean }>(
      "SELECT is_enabled FROM scheduled_candidate_logging_config WHERE id = true",
    );
    if (!config) return NextResponse.json({ error: "Feature migration is not installed." }, { status: 503 });
    if (!config.is_enabled) return NextResponse.json({ error: "Enable scheduled logging before running a batch." }, { status: 409 });

    const result = await runScheduledCandidateLogging({
      triggerType: "manual",
      actorUserId: auth.context.profile.user_id,
      runKey: `scheduled-candidate-logging:manual:${randomUUID()}`,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[Scheduled candidate logging] Manual run failed:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not run the scheduled candidate logging batch.",
    }, { status: 500 });
  }
}
