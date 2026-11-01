import { NextRequest, NextResponse } from "next/server";
import { pruneJobAgentHistory } from "@/server/repositories/jobAgentRunRepository";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const deleted = await pruneJobAgentHistory(15);
    console.info("[job-agent-retention] Removed expired Apify operations history", deleted);
    return NextResponse.json({ ok: true, retentionDays: 15, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[job-agent-retention] History cleanup failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
