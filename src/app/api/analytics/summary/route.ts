// src/app/api/analytics/summary/route.ts
// GET -> top-level summary stats for the analytics dashboard

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  const [candidatesRes, jobsRes, appsMonthRes, interviewsWeekRes, offersRes, hiresRes] =
    await Promise.all([
      supabase
        .from("candidates")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfMonth),
      supabase
        .from("interview_schedules")
        .select("*", { count: "exact", head: true })
        .gte("scheduled_at", startOfWeek),
      supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .eq("status", "offer")
        .gte("created_at", dateFrom || "1970-01-01")
        .lte("created_at", dateTo || "9999-12-31"),
      supabase
        .from("candidates")
        .select("*", { count: "exact", head: true })
        .eq("status", "placed")
        .gte("created_at", dateFrom || "1970-01-01")
        .lte("created_at", dateTo || "9999-12-31"),
    ]);

  return NextResponse.json({
    totalCandidates: candidatesRes.count ?? 0,
    activeJobs: jobsRes.count ?? 0,
    applicationsThisMonth: appsMonthRes.count ?? 0,
    interviewsThisWeek: interviewsWeekRes.count ?? 0,
    offersExtended: offersRes.count ?? 0,
    hiresMade: hiresRes.count ?? 0,
  });
}
