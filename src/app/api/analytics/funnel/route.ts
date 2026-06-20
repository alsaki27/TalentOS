// src/app/api/analytics/funnel/route.ts
// GET -> hiring funnel counts with conversion rates per stage

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

  // TODO: Neon equivalent needed for RPC get_funnel_counts
  const { data: rows, error } = await supabase.rpc("get_funnel_counts", {
    date_from: dateFrom,
    date_to: dateTo,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stageMap = new Map<string, number>();
  for (const row of rows ?? []) {
    stageMap.set(row.stage, Number(row.count));
  }

  const sourced = stageMap.get("sourced") || 0;
  const applied = stageMap.get("applied") || 0;
  const screened = stageMap.get("screened") || 0;
  const interviewed = stageMap.get("interviewed") || 0;
  const offered = stageMap.get("offered") || 0;
  const hired = stageMap.get("hired") || 0;

  const rate = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

  const stages = [
    { stage: "Sourced", count: sourced, conversionRate: null as number | null },
    { stage: "Applied", count: applied, conversionRate: rate(applied, sourced) },
    { stage: "Screened", count: screened, conversionRate: rate(screened, applied) },
    { stage: "Interviewed", count: interviewed, conversionRate: rate(interviewed, screened) },
    { stage: "Offered", count: offered, conversionRate: rate(offered, interviewed) },
    { stage: "Hired", count: hired, conversionRate: rate(hired, offered) },
  ];

  return NextResponse.json({
    stages,
    totalCandidates: sourced,
    totalApplications: applied,
  });
}
