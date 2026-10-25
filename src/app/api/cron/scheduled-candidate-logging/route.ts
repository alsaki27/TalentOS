import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledCandidateLogging } from "@/server/services/scheduledCandidateLoggingService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function dhakaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedTrigger = request.headers.get("x-scheduled-logging-trigger");
  const triggerType = requestedTrigger === "manual" ? "manual" : "scheduled";
  const runKey = triggerType === "scheduled"
    ? `scheduled-candidate-logging:daily:${dhakaDate(new Date())}`
    : `scheduled-candidate-logging:workflow-dispatch:${randomUUID()}`;

  try {
    const result = await runScheduledCandidateLogging({ triggerType, runKey });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[Scheduled candidate logging] Cron run failed:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Scheduled candidate logging failed.",
    }, { status: 500 });
  }
}
