import { NextRequest, NextResponse } from "next/server";
import { runGmailSync } from "@/server/services/gmailSyncService";

export async function POST(req: NextRequest) {
  const expected = process.env.GMAIL_PUSH_TOKEN || process.env.GMAIL_PUSH_SECRET;
  const supplied = new URL(req.url).searchParams.get("token") || req.headers.get("x-gmail-push-secret");
  if (!expected || supplied !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Gmail Pub/Sub notifications only say that history changed; the worker
  // remains the source of truth and fetches the delta using each account's
  // history cursor. Polling continues as a fallback if Pub/Sub is unavailable.
  const result = await runGmailSync();
  return NextResponse.json({ ok: true, accounts: result.accounts.length });
}
