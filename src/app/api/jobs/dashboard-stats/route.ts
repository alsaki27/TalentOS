import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const timeframe = parseInt(url.searchParams.get("timeframe") || "24", 10);
  
  // Calculate the cutoff date
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - timeframe);
  const cutoffISO = cutoffDate.toISOString();

  try {
    // We want to fetch stats for jobs created within the given timeframe.
    // 1. Total jobs
    // 2. Breakdown by source
    // 3. Active vs Inactive
    // 4. AI extraction success (parsed_description IS NOT NULL)

    const sql = `
      SELECT 
        source, 
        COUNT(*) as count,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN parsed_description IS NOT NULL THEN 1 ELSE 0 END) as ai_extracted_count
      FROM jobs
      WHERE created_at >= $1
      GROUP BY source
    `;

    const rows = await query<{ source: string | null; count: string; active_count: string; ai_extracted_count: string }>(sql, [cutoffISO]);

    let totalJobs = 0;
    let totalActive = 0;
    let totalAiExtracted = 0;
    const sourceBreakdown: { source: string; count: number }[] = [];

    for (const row of rows) {
      const c = parseInt(row.count || "0", 10);
      const ac = parseInt(row.active_count || "0", 10);
      const aic = parseInt(row.ai_extracted_count || "0", 10);
      
      totalJobs += c;
      totalActive += ac;
      totalAiExtracted += aic;
      
      const s = row.source ? row.source : "Unknown";
      sourceBreakdown.push({ source: s, count: c });
    }
    
    // Sort sources by count descending
    sourceBreakdown.sort((a, b) => b.count - a.count);

    return NextResponse.json({
      timeframe,
      totalJobs,
      totalActive,
      totalAiExtracted,
      sourceBreakdown
    });
  } catch (error: any) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ error: error.message || "Failed to load dashboard stats" }, { status: 500 });
  }
}
