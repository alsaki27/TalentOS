// src/app/api/analytics/diversity/route.ts
// GET -> gender, ethnicity, and geography breakdowns

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;

  let candidates: any[] = [];
  if (isNeon()) {
    const whereClauses: string[] = [];
    const params: (string | null)[] = [];
    if (dateFrom) { whereClauses.push(`created_at >= $${params.length + 1}`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`created_at <= $${params.length + 1}`); params.push(dateTo); }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    candidates = await query<any>(`SELECT gender, ethnicity, country FROM candidates ${where}`, params);
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("candidates")
      .select("gender, ethnicity, country");
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);
    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    candidates = data ?? [];
  }

  const genderCounts: Record<string, number> = {};
  const ethnicityCounts: Record<string, number> = {};
  const geographyCounts: Record<string, number> = {};
  let genderTotal = 0;
  let ethnicityTotal = 0;
  let geographyTotal = 0;

  for (const c of candidates) {
    if (c.gender) {
      genderCounts[c.gender] = (genderCounts[c.gender] || 0) + 1;
      genderTotal++;
    }
    if (c.ethnicity) {
      ethnicityCounts[c.ethnicity] = (ethnicityCounts[c.ethnicity] || 0) + 1;
      ethnicityTotal++;
    }
    if (c.country) {
      geographyCounts[c.country] = (geographyCounts[c.country] || 0) + 1;
      geographyTotal++;
    }
  }

  const toArray = (
    counts: Record<string, number>,
    total: number
  ) =>
    Object.entries(counts)
      .map(([label, count]) => ({
        label,
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    gender: toArray(genderCounts, genderTotal),
    ethnicity: toArray(ethnicityCounts, ethnicityTotal),
    geography: toArray(geographyCounts, geographyTotal),
  });
}
