import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);

  try {
    const keyExists = await queryOne<any>(
      "SELECT id, label, provider FROM ai_api_keys WHERE id = $1",
      [id]
    );
    if (!keyExists) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const totals = await query<any>(
      `SELECT
         COUNT(*)::int as calls,
         COUNT(*) FILTER (WHERE outcome = 'success')::int as success_count,
         COUNT(*) FILTER (WHERE outcome = 'failure')::int as failure_count,
         COUNT(*) FILTER (WHERE outcome = 'timeout')::int as timeout_count,
         COALESCE(SUM(estimated_cost_usd), 0)::numeric as total_cost_usd,
         COALESCE(SUM(input_tokens), 0)::int as total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::int as total_output_tokens,
         COALESCE(AVG(latency_ms)::int, 0) as avg_latency_ms
       FROM ai_usage_events
       WHERE ai_key_id = $1
         AND created_at >= $2::date
         AND created_at < $3::date + INTERVAL '1 day'`,
      [id, dateFrom, dateTo]
    );

    const byAgent = await query<any>(
      `SELECT
         e.automation_id,
         a.label as automation_label,
         COUNT(*)::int as calls,
         COUNT(*) FILTER (WHERE e.outcome = 'success')::int as success_count,
         COUNT(*) FILTER (WHERE e.outcome = 'failure')::int as failure_count,
         COUNT(*) FILTER (WHERE e.outcome = 'timeout')::int as timeout_count,
         COALESCE(SUM(e.estimated_cost_usd), 0)::numeric as cost_usd,
         COALESCE(AVG(e.latency_ms)::int, 0) as avg_latency_ms,
         COALESCE(SUM(e.input_tokens), 0)::int as input_tokens,
         COALESCE(SUM(e.output_tokens), 0)::int as output_tokens
       FROM ai_usage_events e
       LEFT JOIN ai_automations a ON e.automation_id = a.id
       WHERE e.ai_key_id = $1
         AND e.created_at >= $2::date
         AND e.created_at < $3::date + INTERVAL '1 day'
       GROUP BY e.automation_id, a.label
       ORDER BY cost_usd DESC`,
      [id, dateFrom, dateTo]
    );

    const daily = await query<any>(
      `SELECT
         created_at::date as date,
         COUNT(*)::int as calls,
         COUNT(*) FILTER (WHERE outcome = 'success')::int as success_count,
         COUNT(*) FILTER (WHERE outcome = 'failure')::int as failure_count,
         COUNT(*) FILTER (WHERE outcome = 'timeout')::int as timeout_count,
         COALESCE(SUM(estimated_cost_usd), 0)::numeric as cost_usd,
         COALESCE(AVG(latency_ms)::int, 0) as avg_latency_ms,
         COALESCE(SUM(input_tokens), 0)::int as input_tokens,
         COALESCE(SUM(output_tokens), 0)::int as output_tokens
       FROM ai_usage_events
       WHERE ai_key_id = $1
         AND created_at >= $2::date
         AND created_at < $3::date + INTERVAL '1 day'
       GROUP BY created_at::date
       ORDER BY date ASC`,
      [id, dateFrom, dateTo]
    );

    const totalResult = totals[0] ?? {
      calls: 0,
      success_count: 0,
      failure_count: 0,
      timeout_count: 0,
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      avg_latency_ms: 0,
    };

    return NextResponse.json({
      key: keyExists,
      dateRange: { from: dateFrom, to: dateTo },
      totals: {
        calls: totalResult.calls,
        successCount: totalResult.success_count,
        failureCount: totalResult.failure_count,
        timeoutCount: totalResult.timeout_count,
        successRate: totalResult.calls > 0
          ? Math.round((totalResult.success_count / totalResult.calls) * 1000) / 10
          : 0,
        totalCostUsd: typeof totalResult.total_cost_usd === "number"
          ? Math.round(totalResult.total_cost_usd * 100000) / 100000
          : 0,
        totalInputTokens: totalResult.total_input_tokens,
        totalOutputTokens: totalResult.total_output_tokens,
        avgLatencyMs: totalResult.avg_latency_ms,
      },
      byAgent,
      daily,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
