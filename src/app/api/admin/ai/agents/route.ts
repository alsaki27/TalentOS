import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const automations = await query<{
    id: string;
    label: string;
    description: string;
    group_label: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, label, description, group_label, is_active,
            created_at AT TIME ZONE 'UTC' as created_at
     FROM ai_automations
     ORDER BY group_label, label`
  );

  const automationIds = automations.map((a) => a.id);

  let routesByAutomation: Record<string, any[]> = {};
  let configsByAutomation: Record<string, any> = {};
  let usageByAutomation: Record<string, any> = {};
  let lastCallByAutomation: Record<string, string | null> = {};

  if (automationIds.length > 0) {
    const routes = await query<any>(
      `SELECT ar.automation_id, ar.id, ar.ai_key_id, ar.provider, ar.rank, ar.is_enabled,
              ar.model_override, ar.updated_at, ar.updated_by, ar.created_at,
              ak.label as key_label, ak.provider as key_provider,
              ak.model as key_model, ak.key_fingerprint,
              ak.status as key_status
       FROM ai_automation_routes ar
       LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
       WHERE ar.automation_id = ANY($1)
       ORDER BY ar.automation_id, ar.rank`,
      [automationIds]
    );
    for (const r of routes) {
      if (!routesByAutomation[r.automation_id]) routesByAutomation[r.automation_id] = [];
      routesByAutomation[r.automation_id].push(r);
    }

    const configs = await query<any>(
      `SELECT ac.* FROM ai_agent_configs ac
       WHERE ac.automation_id = ANY($1)`,
      [automationIds]
    );
    for (const c of configs) {
      configsByAutomation[c.automation_id] = c;
    }

    const today = new Date().toISOString().slice(0, 10);
    const usageRows = await query<any>(
      `SELECT
         automation_id,
         COUNT(*)::int as calls,
         ROUND(COUNT(*) FILTER (WHERE outcome = 'success') * 100.0 / NULLIF(COUNT(*), 0), 1) as success_rate,
         COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
         COALESCE(AVG(latency_ms)::int, 0) as avg_latency
       FROM ai_usage_events
       WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
         AND automation_id = ANY($2)
       GROUP BY automation_id`,
      [today, automationIds]
    );
    for (const u of usageRows) {
      usageByAutomation[u.automation_id] = u;
    }

    const lastCallRows = await query<any>(
      `SELECT DISTINCT ON (automation_id) automation_id, created_at
       FROM ai_usage_events
       WHERE automation_id = ANY($1)
       ORDER BY automation_id, created_at DESC`,
      [automationIds]
    );
    for (const lc of lastCallRows) {
      lastCallByAutomation[lc.automation_id] = lc.created_at;
    }
  }

  const agents = automations.map((auto) => {
    const routes = routesByAutomation[auto.id] ?? [];
    const config = configsByAutomation[auto.id] ?? null;
    const usage = usageByAutomation[auto.id] ?? { calls: 0, success_rate: 0, total_cost: 0, avg_latency: 0 };

    let configStatus: string;
    const hasActiveRoutes = routes.some((r: any) => r.is_enabled);
    const hasConfig = config !== null && config.is_active;
    const primaryHealthy = routes.length > 0 && routes[0].is_enabled;

    if (!hasActiveRoutes) configStatus = "no_route";
    else if (!hasConfig) configStatus = "no_config";
    else if (!primaryHealthy) configStatus = "primary_unhealthy";
    else if (!auto.is_active) configStatus = "disabled";
    else configStatus = "ready";

    return {
      ...auto,
      routes,
      config,
      today_usage: usage,
      config_status: configStatus,
      last_call_at: lastCallByAutomation[auto.id] ?? null,
    };
  });

  return NextResponse.json({ agents });
}
