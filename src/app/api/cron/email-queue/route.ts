// src/app/api/cron/email-queue/route.ts
// GET -> process pending email queue items.
// Same CRON_SECRET bearer pattern as other /api/cron/* routes.

import { NextRequest, NextResponse } from "next/server";
import { processEmailQueue } from "@/lib/emailQueue";

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

  const result = await processEmailQueue();
  return NextResponse.json({ ok: true, ...result });
}
