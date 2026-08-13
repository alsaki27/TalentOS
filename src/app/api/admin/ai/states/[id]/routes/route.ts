import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeApiError } from "@/lib/utils";
import { sql as getSql, query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const REASONING_EFFORTS = new Set(["off", "low", "medium", "high", "xhigh", "max"]);

interface StateRouteInput {
  ai_key_id?: unknown;
  provider?: unknown;
  model_override?: unknown;
  reasoning_effort?: unknown;
  is_enabled?: unknown;
}

/**
 * Save one automation's route chain inside a named routing-state snapshot.
 *
 * This is deliberately separate from /api/admin/ai/agents/[id]/routes: that
 * endpoint edits the legacy live table. The control center must be able to
 * edit a draft or the active state without silently changing a different
 * state (or losing the user's model/provider choices on the next publish).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const body = await req.json();
    const automationId = typeof body.automation_id === "string" ? body.automation_id.trim() : "";
    const inputRoutes = Array.isArray(body.routes) ? body.routes : null;

    if (!automationId) {
      return NextResponse.json({ error: "automation_id is required" }, { status: 400 });
    }
    if (!inputRoutes || inputRoutes.length === 0) {
      return NextResponse.json({ error: "routes must be a non-empty array" }, { status: 400 });
    }

    const state = await queryOne<any>(
      `SELECT s.id, s.name, s.status,
              (c.active_routing_state_id = s.id) AS is_active
       FROM ai_routing_states s
       LEFT JOIN ai_runtime_config c ON c.singleton = true
       WHERE s.id = $1`,
      [params.id],
    );
    if (!state) return NextResponse.json({ error: "Routing state not found" }, { status: 404 });
    if (state.status === "archived") {
      return NextResponse.json({ error: "Archived routing states cannot be edited" }, { status: 409 });
    }

    const automation = await queryOne<any>(
      "SELECT id FROM ai_automations WHERE id = $1",
      [automationId],
    );
    if (!automation) return NextResponse.json({ error: "Automation not found" }, { status: 404 });

    const normalized = (inputRoutes as StateRouteInput[]).map((route, index: number) => {
      const aiKeyId = typeof route?.ai_key_id === "string" && route.ai_key_id.trim()
        ? route.ai_key_id.trim()
        : null;
      const provider = typeof route?.provider === "string" && route.provider.trim()
        ? route.provider.trim()
        : null;
      const modelOverride = typeof route?.model_override === "string" && route.model_override.trim()
        ? route.model_override.trim()
        : null;
      const reasoningEffort = typeof route?.reasoning_effort === "string" && route.reasoning_effort.trim()
        ? route.reasoning_effort.trim()
        : null;

      if (!aiKeyId && !provider) throw new Error(`Route ${index + 1} must select a provider or connection`);
      if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) {
        throw new Error(`Route ${index + 1} has an invalid reasoning effort`);
      }
      return {
        rank: index + 1,
        aiKeyId,
        provider,
        modelOverride,
        reasoningEffort,
        isEnabled: route?.is_enabled !== false,
      };
    });

    const keyIds = [...new Set(normalized.map((route) => route.aiKeyId).filter(Boolean))] as string[];
    if (keyIds.length > 0) {
      const keys = await query<any>(
        "SELECT id FROM ai_api_keys WHERE id = ANY($1) AND is_enabled = true",
        [keyIds],
      );
      const enabledIds = new Set(keys.map((key: any) => key.id));
      const missing = keyIds.find((id) => !enabledIds.has(id));
      if (missing) {
        return NextResponse.json({ error: "Every selected connection must exist and be enabled" }, { status: 400 });
      }
    }

    const actor = context?.profile.user_id ?? null;
    const sql = getSql();
    await sql.transaction((tx) => [
      tx.query(
        "DELETE FROM ai_routing_state_routes WHERE state_id = $1 AND automation_id = $2",
        [params.id, automationId],
      ),
      ...normalized.map((route) => tx.query(
        `INSERT INTO ai_routing_state_routes
           (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          params.id,
          automationId,
          route.rank,
          route.aiKeyId,
          route.provider,
          route.modelOverride,
          route.reasoningEffort,
          route.isEnabled,
        ],
      )),
      tx.query("UPDATE ai_routing_states SET updated_at = now() WHERE id = $1", [params.id]),
      ...(state.is_active ? [
        tx.query("DELETE FROM ai_automation_routes WHERE automation_id = $1", [automationId]),
        ...normalized.map((route) => tx.query(
          `INSERT INTO ai_automation_routes
             (automation_id, rank, ai_key_id, provider, model_override, is_enabled, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [automationId, route.rank, route.aiKeyId, route.provider, route.modelOverride, route.isEnabled, actor],
        )),
        tx.query("UPDATE ai_automations SET route_version = route_version + 1, updated_at = now() WHERE id = $1", [automationId]),
      ] : []),
    ]);

    try {
      await logActivity({
        userId: actor,
        actorName: context?.profile.display_name || context?.profile.email || "Admin",
        type: "update",
        description: `Updated ${automationId} routes in routing state ${state.name}`,
        entityType: "ai_routing_state_route",
        entityId: params.id,
        entityName: `${state.name} · ${automationId}`,
        metadata: { state_id: params.id, automation_id: automationId, routes: normalized, active_state_synced: Boolean(state.is_active) },
      });
    } catch (activityError: any) {
      console.warn("[ai-state-routes] activity log failed after route save", activityError?.message || activityError);
    }

    const routes = await query<any>(
      `SELECT r.*, k.label AS key_label, k.provider AS key_provider, k.model AS key_model,
              k.key_fingerprint, k.status AS key_status
       FROM ai_routing_state_routes r
       LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
       WHERE r.state_id = $1 AND r.automation_id = $2
       ORDER BY r.rank`,
      [params.id, automationId],
    );
    return NextResponse.json({ state: { id: params.id, name: state.name, is_active: Boolean(state.is_active) }, routes });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : sanitizeApiError(err);
    if (message.startsWith("Route ")) return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
