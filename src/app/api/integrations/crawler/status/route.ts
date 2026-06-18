// src/app/api/integrations/crawler/status/route.ts
// GET -> staff-facing read of every registered crawler's online/offline status.
// Normal session auth (not the API key — that's only for the bot's own push/heartbeat).

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { getCrawlerStatuses } from "@/lib/integrations/jobCrawler";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const statuses = await getCrawlerStatuses();
  return NextResponse.json(statuses);
}
