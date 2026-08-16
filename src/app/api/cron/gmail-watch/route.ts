import { NextRequest, NextResponse } from "next/server";
import { registerGmailWatches } from "@/server/services/gmailSyncService";
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await registerGmailWatches() });
}
