// GET /api/cron/ai-usage-rollup -> aggregates yesterday's ai_usage_events into ai_usage_daily
// Runs daily via vercel.json or Cloudflare Cron Trigger. Gated by CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Aggregate yesterday's events into daily rollup
  const rows = await query<any>(
    `SELECT
       created_at::date as usage_date,
       automation_id,
       ai_key_id,
       provider,
       COUNT(*)::int as call_count,
       COUNT(*) FILTER (WHERE outcome = 'success')::int as success_count,
       COUNT(*) FILTER (WHERE outcome IN ('failure','timeout'))::int as failure_count,
       COALESCE(SUM(input_tokens), 0)::int as total_input_tokens,
       COALESCE(SUM(output_tokens), 0)::int as total_output_tokens,
       COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd,
       COALESCE(AVG(latency_ms)::int, 0) as avg_latency_ms
     FROM ai_usage_events
     WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')
     GROUP BY created_at::date, automation_id, ai_key_id, provider`,
    [yesterday]
  );

  let inserted = 0;
  for (const row of rows) {
    await execute(
      `INSERT INTO ai_usage_daily
        (usage_date, automation_id, ai_key_id, provider,
         call_count, success_count, failure_count,
         total_input_tokens, total_output_tokens, total_cost_usd, avg_latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (usage_date, automation_id, ai_key_id, provider)
       DO UPDATE SET
         call_count = EXCLUDED.call_count,
         success_count = EXCLUDED.success_count,
         failure_count = EXCLUDED.failure_count,
         total_input_tokens = EXCLUDED.total_input_tokens,
         total_output_tokens = EXCLUDED.total_output_tokens,
         total_cost_usd = EXCLUDED.total_cost_usd,
         avg_latency_ms = EXCLUDED.avg_latency_ms`,
      [
        row.usage_date, row.automation_id, row.ai_key_id, row.provider,
        row.call_count, row.success_count, row.failure_count,
        row.total_input_tokens, row.total_output_tokens, row.total_cost_usd, row.avg_latency_ms,
      ]
    );
    inserted++;
  }

  return NextResponse.json({
    ok: true,
    date: yesterday,
    rowsInserted: inserted,
  });
}
