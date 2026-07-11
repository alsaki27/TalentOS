import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
    const dateFrom = url.searchParams.get("from") || "";
    const dateTo = url.searchParams.get("to") || "";
    const automationId = url.searchParams.get("automationId") || "";
    const aiKeyId = url.searchParams.get("aiKeyId") || "";
    const provider = url.searchParams.get("provider") || "";
    const model = url.searchParams.get("model") || "";
    const outcome = url.searchParams.get("outcome") || "";
    const triggeredByUserId = url.searchParams.get("triggeredByUserId") || "";
    const applicationId = url.searchParams.get("applicationId") || "";
    const workflowId = url.searchParams.get("workflowId") || "";
    const fallbackOnly = url.searchParams.get("fallbackOnly") === "true";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`e.created_at >= $${idx++}::date`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`e.created_at < $${idx++}::date + interval '1 day'`);
      params.push(dateTo);
    }
    if (automationId) {
      conditions.push(`e.automation_id = $${idx++}`);
      params.push(automationId);
    }
    if (aiKeyId) {
      conditions.push(`e.ai_key_id = $${idx++}`);
      params.push(aiKeyId);
    }
    if (provider) {
      conditions.push(`e.provider = $${idx++}`);
      params.push(provider);
    }
    if (model) {
      conditions.push(`e.model = $${idx++}`);
      params.push(model);
    }
    if (outcome) {
      conditions.push(`e.outcome = $${idx++}`);
      params.push(outcome);
    }
    if (triggeredByUserId) {
      conditions.push(`e.triggered_by_user_id = $${idx++}`);
      params.push(triggeredByUserId);
    }
    if (applicationId) {
      conditions.push(`e.application_id = $${idx++}`);
      params.push(applicationId);
    }
    if (workflowId) {
      conditions.push(`e.workflow_id = $${idx++}`);
      params.push(workflowId);
    }
    if (fallbackOnly) {
      conditions.push(`COALESCE(e.attempt_number, 1) > 1`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const offset = (page - 1) * pageSize;

    const countRes = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM ai_usage_events e ${where}`,
      params
    );

    const events = await query<any>(
      `SELECT
         e.id, e.automation_id, e.ai_key_id, e.provider, e.model,
         e.outcome, e.route_rank, e.attempt_number,
         e.latency_ms, e.input_tokens, e.output_tokens,
         e.estimated_cost_usd, e.error_code, e.error_message,
         e.workflow_id, e.application_id, e.triggered_by_user_id,
         e.created_at,
         a.label as automation_label,
         ak.label as key_label
       FROM ai_usage_events e
       LEFT JOIN ai_automations a ON e.automation_id = a.id
       LEFT JOIN ai_api_keys ak ON e.ai_key_id = ak.id
       ${where}
       ORDER BY e.created_at DESC
       OFFSET $${idx++} LIMIT $${idx++}`,
      [...params, offset, pageSize]
    );

    const metricsRes = await queryOne<{
      total_calls: number;
      success_calls: number;
      failed_calls: number;
      timeouts: number;
      fallback_activations: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost: number;
      avg_latency: number;
    }>(
      `SELECT
         COUNT(*)::int as total_calls,
         COUNT(*) FILTER (WHERE e.outcome = 'success')::int as success_calls,
         COUNT(*) FILTER (WHERE e.outcome = 'failure')::int as failed_calls,
         COUNT(*) FILTER (WHERE e.outcome = 'timeout')::int as timeouts,
         COUNT(*) FILTER (WHERE COALESCE(e.attempt_number, 1) > 1)::int as fallback_activations,
         COALESCE(SUM(COALESCE(e.input_tokens, 0)), 0)::bigint as total_input_tokens,
         COALESCE(SUM(COALESCE(e.output_tokens, 0)), 0)::bigint as total_output_tokens,
         COALESCE(SUM(e.estimated_cost_usd), 0) as total_cost,
         COALESCE(AVG(e.latency_ms)::int, 0) as avg_latency
       FROM ai_usage_events e
       ${where}`,
      params
    );

    const totalCalls = metricsRes?.total_calls ?? 0;
    const successCalls = metricsRes?.success_calls ?? 0;
    const successRate =
      totalCalls > 0
        ? Math.round((successCalls / totalCalls) * 1000) / 10
        : 0;

    let p95Latency = 0;
    try {
      const p95Res = await queryOne<{ p95: number | null }>(
        `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int as p95
         FROM ai_usage_events e ${where}`,
        params
      );
      p95Latency = p95Res?.p95 ?? 0;
    } catch {
      p95Latency = 0;
    }

    return NextResponse.json({
      events,
      total: countRes?.total ?? 0,
      page,
      pageSize,
      metrics: {
        totalCalls,
        successCalls,
        failedCalls: metricsRes?.failed_calls ?? 0,
        timeouts: metricsRes?.timeouts ?? 0,
        fallbackActivations: metricsRes?.fallback_activations ?? 0,
        totalInputTokens: Number(metricsRes?.total_input_tokens ?? 0),
        totalOutputTokens: Number(metricsRes?.total_output_tokens ?? 0),
        totalCost:
          Math.round((metricsRes?.total_cost ?? 0) * 100000) / 100000,
        avgLatency: metricsRes?.avg_latency ?? 0,
        p95Latency,
        successRate,
      },
    });
  } catch (err: any) {
    console.error("[ai/usage]", err.message || err);
    return NextResponse.json(
      { error: "Failed to load usage data" },
      { status: 500 }
    );
  }
}
