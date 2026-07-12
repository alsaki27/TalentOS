// src/app/api/cron/email-queue/route.ts
// GET -> process pending email queue items.
// Same CRON_SECRET bearer pattern as other /api/cron/* routes.

import { NextRequest, NextResponse } from "next/server";
import { processEmailQueue } from "@/lib/emailQueue";
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

  const startedMs = Date.now();
  await recordJobAttempt("email-queue");

  try {
    const result = await processEmailQueue();
    const durationMs = Date.now() - startedMs;
    await recordJobSuccess("email-queue", durationMs, JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const durationMs = Date.now() - startedMs;
    await recordJobFailure("email-queue", err.message ?? "email queue failed", durationMs);
    return NextResponse.json({ error: err.message ?? "email queue failed" }, { status: 500 });
  }
}
