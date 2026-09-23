// src/app/api/analytics/summary/route.ts
// GET -> top-level summary stats for the analytics dashboard

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay()
  ).toISOString();

  let totalCandidates = 0;
  let activeJobs = 0;
  let applicationsThisMonth = 0;
  let interviewsThisWeek = 0;
  let offersExtended = 0;
  let hiresMade = 0;

  try {
    const [candidatesRes, jobsRes, appsMonthRes, interviewsWeekRes, offersRes, hiresRes] =
      await Promise.all([
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM candidates`),
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM jobs WHERE is_active = true`),
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM applications WHERE applied_at >= $1`, [startOfMonth]),
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM interview_schedules WHERE scheduled_at >= $1`, [startOfWeek]),
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM applications WHERE status = 'offer' AND applied_at >= $1 AND applied_at <= $2`, [dateFrom || "1970-01-01", dateTo || "9999-12-31"]),
        queryOne<{count: number}>(`SELECT COUNT(*)::int as count FROM candidates WHERE status = 'placed' AND created_at >= $1 AND created_at <= $2`, [dateFrom || "1970-01-01", dateTo || "9999-12-31"]),
      ]);
    totalCandidates = candidatesRes?.count ?? 0;
    activeJobs = jobsRes?.count ?? 0;
    applicationsThisMonth = appsMonthRes?.count ?? 0;
    interviewsThisWeek = interviewsWeekRes?.count ?? 0;
    offersExtended = offersRes?.count ?? 0;
    hiresMade = hiresRes?.count ?? 0;
  } catch (e: any) {
    console.error("[analytics/summary] Error:", e.message || e);
    return NextResponse.json({ error: e.message || "Analytics query failed" }, { status: 500 });
  }

  return NextResponse.json({
    totalCandidates,
    activeJobs,
    applicationsThisMonth,
    interviewsThisWeek,
    offersExtended,
    hiresMade,
  });
}
