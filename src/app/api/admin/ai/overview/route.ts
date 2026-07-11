import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const CRITICAL_AGENT_IDS = [
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
];

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const today = new Date().toISOString().slice(0, 10);

    const keyStats = await queryOne<{
      total_keys: number;
      active_keys: number;
      healthy_keys: number;
      keys_with_errors: number;
      unencrypted_keys: number;
      keys_not_tested_7d: number;
    }>(
      `SELECT
         COUNT(*)::int as total_keys,
         COUNT(*) FILTER (WHERE is_enabled = true)::int as active_keys,
         COUNT(*) FILTER (WHERE status = 'working')::int as healthy_keys,
         COUNT(*) FILTER (WHERE status = 'failing')::int as keys_with_errors,
         COUNT(*) FILTER (WHERE encrypted_key IS NOT NULL AND encrypted_key NOT LIKE 'enc:%')::int as unencrypted_keys,
         COUNT(*) FILTER (WHERE last_tested_at IS NULL OR last_tested_at < NOW() - interval '7 days')::int as keys_not_tested_7d
       FROM ai_api_keys`
    );

    const agentStats = await queryOne<{
      total_agents: number;
      configured_agents: number;
      unrouted_agents: number;
    }>(
      `SELECT
         COUNT(*)::int as total_agents,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_automation_routes ar WHERE ar.automation_id = a.id))::int as configured_agents,
         COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ai_automation_routes ar WHERE ar.automation_id = a.id))::int as unrouted_agents
       FROM ai_automations a`
    );

    const todayStats = await queryOne<{
      calls_today: number;
      tokens_today: number;
      cost_today: number;
      success_count: number;
      fallback_activations: number;
      avg_latency: number;
    }>(
      `SELECT
         COUNT(*)::int as calls_today,
         COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint as tokens_today,
         COALESCE(SUM(estimated_cost_usd), 0) as cost_today,
         COUNT(*) FILTER (WHERE outcome = 'success')::int as success_count,
         COUNT(*) FILTER (WHERE COALESCE(attempt_number, 1) > 1 OR COALESCE(route_rank, 1) > 1)::int as fallback_activations,
         COALESCE(AVG(latency_ms)::int, 0) as avg_latency
       FROM ai_usage_events
       WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'`,
      [today]
    );

    const criticalRoutes = await query<{ automation_id: string }>(
      `SELECT DISTINCT automation_id
       FROM ai_automation_routes
       WHERE automation_id = ANY($1)`,
      [CRITICAL_AGENT_IDS]
    );

    const routedCriticalIds = new Set(criticalRoutes.map((r) => r.automation_id));
    const criticalAgentsRouted = CRITICAL_AGENT_IDS.every((id) =>
      routedCriticalIds.has(id)
    );

    const hasRecentUsage = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ai_usage_events
         WHERE created_at >= NOW() - interval '24 hours'
       ) as exists`
    );

    const trafficByProvider = await query<{
      provider: string;
      calls: number;
      cost: number;
    }>(
      `SELECT
         provider,
         COUNT(*)::int as calls,
         COALESCE(SUM(estimated_cost_usd), 0) as cost
       FROM ai_usage_events
       WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
       GROUP BY provider
       ORDER BY calls DESC`,
      [today]
    );

    const recentIncidents = await query<{
      timestamp: string;
      key_id: string;
      key_label: string;
      event: string;
    }>(
      `SELECT
         e.created_at as timestamp,
         e.ai_key_id::text as key_id,
         COALESCE(ak.label, e.provider) as key_label,
         CASE
           WHEN e.outcome = 'failure' THEN 'API call failed'
           WHEN e.outcome = 'timeout' THEN 'API call timed out'
           ELSE e.outcome
         END as event
       FROM ai_usage_events e
       LEFT JOIN ai_api_keys ak ON e.ai_key_id = ak.id
       WHERE e.outcome != 'success'
       ORDER BY e.created_at DESC
       LIMIT 20`
    );

    const callsToday = todayStats?.calls_today ?? 0;
    const successCount = todayStats?.success_count ?? 0;
    const successRate =
      callsToday > 0
        ? Math.round((successCount / callsToday) * 1000) / 10
        : 0;

    const encryptionConfigured = !!process.env.AI_KEYS_ENCRYPTION_SECRET;
    const allKeysEncrypted = (keyStats?.unencrypted_keys ?? 0) === 0;

    const alerts: Array<{
      type: string;
      severity: "info" | "warning" | "critical";
      message: string;
      resourceType: string;
      resourceId: string;
    }> = [];

    if ((keyStats?.keys_with_errors ?? 0) > 0) {
      const failingKeys = await query<{ id: string; label: string }>(
        `SELECT id::text, label FROM ai_api_keys WHERE status = 'failing'`
      );
      for (const k of failingKeys) {
        alerts.push({
          type: "key_failing",
          severity: "critical",
          message: `API key "${k.label}" is failing`,
          resourceType: "ai_api_key",
          resourceId: k.id,
        });
      }
    }

    if ((keyStats?.keys_not_tested_7d ?? 0) > 0) {
      const untested = await query<{ id: string; label: string }>(
        `SELECT id::text, label FROM ai_api_keys
         WHERE last_tested_at IS NULL OR last_tested_at < NOW() - interval '7 days'
         LIMIT 10`
      );
      for (const k of untested) {
        alerts.push({
          type: "key_untested",
          severity: "warning",
          message: `API key "${k.label}" has not been tested in 7 days`,
          resourceType: "ai_api_key",
          resourceId: k.id,
        });
      }
    }

    if ((agentStats?.unrouted_agents ?? 0) > 0) {
      const unrouted = await query<{ id: string; label: string }>(
        `SELECT a.id, a.label
         FROM ai_automations a
         WHERE NOT EXISTS (SELECT 1 FROM ai_automation_routes ar WHERE ar.automation_id = a.id)
         LIMIT 10`
      );
      for (const a of unrouted) {
        alerts.push({
          type: "agent_unrouted",
          severity: "warning",
          message: `Agent "${a.label}" has no routes configured`,
          resourceType: "ai_automation",
          resourceId: a.id,
        });
      }
    }

    if (!encryptionConfigured) {
      alerts.push({
        type: "encryption_missing",
        severity: "critical",
        message: "AI_KEYS_ENCRYPTION_SECRET is not configured",
        resourceType: "system",
        resourceId: "encryption",
      });
    }

    if (!criticalAgentsRouted) {
      alerts.push({
        type: "critical_agents_unrouted",
        severity: "critical",
        message: "One or more application workflow agents have no routes configured",
        resourceType: "ai_automation",
        resourceId: "application_agents",
      });
    }

    return NextResponse.json({
      summary: {
        totalKeys: keyStats?.total_keys ?? 0,
        activeKeys: keyStats?.active_keys ?? 0,
        healthyKeys: keyStats?.healthy_keys ?? 0,
        keysWithErrors: keyStats?.keys_with_errors ?? 0,
        totalAgents: agentStats?.total_agents ?? 0,
        configuredAgents: agentStats?.configured_agents ?? 0,
        unroutedAgents: agentStats?.unrouted_agents ?? 0,
        callsToday,
        tokensToday: Number(todayStats?.tokens_today ?? 0),
        costToday: Math.round((todayStats?.cost_today ?? 0) * 100000) / 100000,
        successRate,
        fallbackActivations: todayStats?.fallback_activations ?? 0,
        avgLatency: todayStats?.avg_latency ?? 0,
      },
      readiness: {
        encryptionConfigured,
        allKeysEncrypted,
        criticalAgentsRouted,
        usageTrackingOperational: hasRecentUsage?.exists ?? false,
      },
      alerts,
      trafficByProvider,
      recentIncidents,
    });
  } catch (err: any) {
    console.error("[ai/overview]", err.message || err);
    return NextResponse.json(
      { error: "Failed to load AI overview" },
      { status: 500 }
    );
  }
}
