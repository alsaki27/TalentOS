// src/app/api/cron/digest/route.ts
// GET -> generate and store the daily AI digest (see vercel.json for the schedule).
// Same CRON_SECRET bearer pattern as the other /api/cron/* routes; src/middleware.ts's
// generic /api/cron bypass already covers this path.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { generateDailyDigest } from "@/lib/ai/digest";
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
  await recordJobAttempt("digest");

  const result = await generateDailyDigest();
  const durationMs = Date.now() - startedAt;

  if ("error" in result) {
    const errMsg = result.error;
    await query(
      "INSERT INTO ai_digests (content, provider, last_error) VALUES ($1, $2, $3)",
      ["(generation failed)", "unknown", errMsg]
    );
    await recordJobFailure("digest", errMsg, durationMs);
    return NextResponse.json(result, { status: 502 });
  }

  await query(
    "INSERT INTO ai_digests (content, provider, last_success_at, data_summary) VALUES ($1, $2, NOW(), $3)",
    [result.content, result.provider, JSON.stringify(result.dataSummary)]
  );

  await recordJobSuccess("digest", durationMs, JSON.stringify(result.dataSummary));
  return NextResponse.json({ ok: true, provider: result.provider });
}
