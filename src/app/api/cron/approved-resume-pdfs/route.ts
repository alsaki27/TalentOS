import { NextRequest, NextResponse } from "next/server";
import { runApprovedResumePdfJobs } from "@/server/services/approvedResumePdfJobs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runApprovedResumePdfJobs(request.headers.get("x-sweep-unpublished") === "1"));
  } catch {
    console.error("[resume-approval] Scheduled PDF processing failed.");
    return NextResponse.json({ error: "Could not process approved PDF jobs." }, { status: 500 });
  }
}
