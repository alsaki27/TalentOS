import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { startRun } from "@/server/services/jobCeoService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schedules = await query<any>("SELECT * FROM job_ceo_schedule ORDER BY updated_at DESC LIMIT 1");
    if (schedules.length === 0 || !schedules[0].is_enabled) {
      return NextResponse.json({ skipped: true, reason: "Schedule disabled or not set" });
    }

    const sched = schedules[0];
    
    // Start the run
    const run = await startRun({
      source: "openjobdata",
      triggerType: "schedule",
      startedBy: "cron",
      scoutTerms: {
        roleGroup: sched.role_group,
        daysBack: sched.days_back,
        customKeywords: null
      }
    });

    // Also trigger dispatch so it starts moving through the pipeline
    const baseUrl = process.env.TALENTOS_BASE_URL || "http://localhost:3000";
    fetch(`${baseUrl}/api/job-ceo/dispatch`, {
      method: "POST",
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined
    }).catch(err => console.error("[Job CEO Cron] Dispatch failed:", err));

    return NextResponse.json({ success: true, run });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
