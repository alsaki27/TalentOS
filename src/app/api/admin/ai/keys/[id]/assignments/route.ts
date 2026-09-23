import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    const key = await queryOne<any>(
      "SELECT id, label, provider, model, is_enabled, status, priority FROM ai_api_keys WHERE id = $1",
      [id]
    );

    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const routes = await query<any>(
      `SELECT ar.*, a.label as automation_label, a.description as automation_description, a.group_label as automation_group
       FROM ai_automation_routes ar
       LEFT JOIN ai_automations a ON ar.automation_id = a.id
       WHERE ar.ai_key_id = $1
       ORDER BY ar.rank ASC`,
      [id]
    );

    const primaryFor = routes
      .filter((r: any) => r.rank === 1 && r.is_enabled)
      .map((r: any) => ({
        routeId: r.id,
        automationId: r.automation_id,
        automationLabel: r.automation_label,
        automationDescription: r.automation_description,
        automationGroup: r.automation_group,
        rank: r.rank,
        modelOverride: r.model_override ?? null,
      }));

    const fallbackFor = routes
      .filter((r: any) => r.rank > 1 && r.is_enabled)
      .map((r: any) => ({
        routeId: r.id,
        automationId: r.automation_id,
        automationLabel: r.automation_label,
        automationDescription: r.automation_description,
        automationGroup: r.automation_group,
        rank: r.rank,
        modelOverride: r.model_override ?? null,
      }));

    const recentTraffic = await query<any>(
      `SELECT
         COUNT(*)::int as calls_24h,
         COUNT(*) FILTER (WHERE outcome = 'success')::int as success_24h,
         COUNT(*) FILTER (WHERE outcome = 'failure')::int as failure_24h,
         COALESCE(SUM(estimated_cost_usd), 0)::numeric as cost_24h,
         COALESCE(AVG(latency_ms)::int, 0) as avg_latency_24h
       FROM ai_usage_events
       WHERE ai_key_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
      [id]
    );

    const recentErrors = await query<any>(
      `SELECT
         automation_id,
         outcome,
         error_message,
         latency_ms,
         created_at
       FROM ai_usage_events
       WHERE ai_key_id = $1
         AND outcome IN ('failure', 'timeout')
         AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    return NextResponse.json({
      key: {
        ...key,
        totalAssignments: routes.length,
        primaryCount: primaryFor.length,
        fallbackCount: fallbackFor.length,
      },
      primaryFor,
      fallbackFor,
      recentTraffic: recentTraffic[0] ?? {
        calls_24h: 0,
        success_24h: 0,
        failure_24h: 0,
        cost_24h: 0,
        avg_latency_24h: 0,
      },
      recentErrors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
