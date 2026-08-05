// src/app/api/cron/gmail-sync/route.ts
// GET -> pull new Gmail messages for every connected candidate account, AI-triage
// them, and enqueue overdue follow-ups. Same CRON_SECRET bearer pattern as every
// other /api/cron/* route; src/middleware.ts's generic /api/cron bypass already
// covers this path — no middleware changes needed.

import { NextRequest, NextResponse } from "next/server";
import { runGmailSync } from "@/server/services/gmailSyncService";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  await recordJobAttempt("gmail-sync");

  try {
    const result = await runGmailSync();
    const durationMs = Date.now() - startedAt;
    await recordJobSuccess(
      "gmail-sync",
      durationMs,
      `${result.accounts.length} account(s) processed, ${result.followUpsEnqueued} follow-up(s) enqueued`
    );
    return NextResponse.json(result);
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const message = err?.message || "Gmail sync failed";
    await recordJobFailure("gmail-sync", message, durationMs);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
