// GET /api/admin/ai-usage/summary -> usage summary with totals, by-automation, by-key, trend
// Admin-only. Params: from, to, automationId, aiKeyId, groupBy

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const automationFilter = url.searchParams.get("automationId") || "";
  const keyFilter = url.searchParams.get("aiKeyId") || "";

  // Build WHERE clause
  const conditions: string[] = ["created_at >= $1::date", "created_at <= $2::date + interval '1 day'"];
  const params: (string | number)[] = [dateFrom, dateTo];
  let idx = 3;
  if (automationFilter) {
    conditions.push(`automation_id = $${idx++}`);
    params.push(automationFilter);
  }
  if (keyFilter) {
    conditions.push(`ai_key_id = $${idx++}`);
    params.push(keyFilter);
  }
  const where = conditions.join(" AND ");

  // Totals
  const totals = await query<any>(
    `SELECT
       COUNT(*)::int as calls,
       COUNT(*) FILTER (WHERE outcome = 'success')::int as success_count,
       COUNT(*) FILTER (WHERE outcome = 'failure')::int as failure_count,
       COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd,
       COALESCE(AVG(latency_ms)::int, 0) as avg_latency_ms
     FROM ai_usage_events WHERE ${where}`,
    params
  );

  const totalCalls = totals[0]?.calls ?? 0;
  const totalSuccess = totals[0]?.success_count ?? 0;
  const totalCost = totals[0]?.total_cost_usd ?? 0;
  const avgLatency = totals[0]?.avg_latency_ms ?? 0;
  const successRate = totalCalls > 0 ? Math.round((totalSuccess / totalCalls) * 1000) / 10 : 0;

  // By automation
  const byAutomation = await query<any>(
    `SELECT
       e.automation_id,
       a.label,
       COUNT(*)::int as calls,
       COALESCE(SUM(e.estimated_cost_usd), 0) as cost_usd,
       ROUND(COUNT(*) FILTER (WHERE e.outcome = 'success') * 100.0 / NULLIF(COUNT(*), 0), 1) as success_rate,
       COALESCE(AVG(e.latency_ms)::int, 0) as avg_latency_ms
     FROM ai_usage_events e
     LEFT JOIN ai_automations a ON e.automation_id = a.id
     WHERE ${where}
     GROUP BY e.automation_id, a.label
     ORDER BY cost_usd DESC`,
    params
  );

  // By key
  const byKey = await query<any>(
    `SELECT
       e.ai_key_id,
       ak.label,
       ak.provider,
       COUNT(*)::int as calls,
       COALESCE(SUM(e.estimated_cost_usd), 0) as cost_usd,
       ROUND(COUNT(*) FILTER (WHERE e.outcome = 'success') * 100.0 / NULLIF(COUNT(*), 0), 1) as success_rate
     FROM ai_usage_events e
     LEFT JOIN ai_api_keys ak ON e.ai_key_id = ak.id
     WHERE ${where}
     GROUP BY e.ai_key_id, ak.label, ak.provider
     ORDER BY cost_usd DESC`,
    params
  );

  // Trend (per day)
  const trend = await query<any>(
    `SELECT
       created_at::date as date,
       COUNT(*)::int as calls,
       COALESCE(SUM(estimated_cost_usd), 0) as cost_usd
     FROM ai_usage_events WHERE ${where}
     GROUP BY created_at::date
     ORDER BY date ASC`,
    params
  );

  return NextResponse.json({
    totals: {
      calls: totalCalls,
      successRate,
      totalCostUsd: Math.round(totalCost * 100000) / 100000,
      avgLatencyMs: avgLatency,
    },
    byAutomation,
    byKey,
    trend,
  });
}
