import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeApiError } from "@/lib/utils";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const userId = context?.profile.user_id;
  const actorName = context?.profile.display_name || context?.profile.email || "Admin";
  const actor = { userId, actorName };

  try {
    switch (action) {
      case "assign_primary":
        return await handleAssignPrimary(body, actor);
      case "add_fallback":
        return await handleAddFallback(body, actor);
      case "replace_key":
        return await handleReplaceKey(body, actor);
      case "remove_key":
        return await handleRemoveKey(body, actor);
      case "copy_routes":
        return await handleCopyRoutes(body, actor);
      case "disable_agents":
        return await handleDisableAgents(body, actor);
      case "enable_agents":
        return await handleEnableAgents(body, actor);
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error(`[bulk-routes] ${action} failed:`, err.message || err);
    return NextResponse.json(
      { error: sanitizeApiError(err) },
      { status: 500 }
    );
  }
}

async function handleAssignPrimary(body: any, actor: { userId?: string; actorName: string }) {
  const { key_id, agent_ids } = body;
  if (!key_id || typeof key_id !== "string") {
    return NextResponse.json({ error: "key_id is required" }, { status: 400 });
  }
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids must be a non-empty array" }, { status: 400 });
  }

  const key = await queryOne<any>("SELECT id FROM ai_api_keys WHERE id = $1 AND is_enabled = true", [key_id]);
  if (!key) {
    return NextResponse.json({ error: "Key not found or not enabled" }, { status: 400 });
  }

  let updated = 0;
  for (const agentId of agent_ids) {
    const auto = await queryOne<any>("SELECT id FROM ai_automations WHERE id = $1", [agentId]);
    if (!auto) continue;

    const existing = await query<any>(
      "SELECT id FROM ai_automation_routes WHERE automation_id = $1 AND ai_key_id = $2",
      [agentId, key_id]
    );

    if (existing.length > 0) {
      await execute(
        "DELETE FROM ai_automation_routes WHERE automation_id = $1 AND ai_key_id = $2",
        [agentId, key_id]
      );
    }

    await execute(
      "UPDATE ai_automation_routes SET rank = rank + 1 WHERE automation_id = $1",
      [agentId]
    );

    await execute(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled, updated_by)
       VALUES ($1, $2, 0, true, $3)`,
       [agentId, key_id, actor.userId]
    );
    updated++;
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk assign_primary: key ${key_id} as rank 0 for ${updated} agent(s)`,
    entityType: "ai_automation_route",
    metadata: { action: "assign_primary", key_id, agent_ids, updated },
  });

  return NextResponse.json({
    action: "assign_primary",
    summary: `Assigned key ${key_id} as rank 0 for ${updated} agent(s)`,
    updated,
  });
}

async function handleAddFallback(body: any, actor: { userId?: string; actorName: string }) {
  const { key_id, agent_ids } = body;
  if (!key_id || typeof key_id !== "string") {
    return NextResponse.json({ error: "key_id is required" }, { status: 400 });
  }
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids must be a non-empty array" }, { status: 400 });
  }

  const key = await queryOne<any>("SELECT id FROM ai_api_keys WHERE id = $1 AND is_enabled = true", [key_id]);
  if (!key) {
    return NextResponse.json({ error: "Key not found or not enabled" }, { status: 400 });
  }

  let updated = 0;
  for (const agentId of agent_ids) {
    const auto = await queryOne<any>("SELECT id FROM ai_automations WHERE id = $1", [agentId]);
    if (!auto) continue;

    const existing = await queryOne<any>(
      "SELECT id FROM ai_automation_routes WHERE automation_id = $1 AND ai_key_id = $2",
      [agentId, key_id]
    );
    if (existing) continue;

    const maxRank = await queryOne<any>(
      "SELECT COALESCE(MAX(rank), -1) as max_rank FROM ai_automation_routes WHERE automation_id = $1",
      [agentId]
    );

    const nextRank = (maxRank?.max_rank ?? -1) + 1;
    await execute(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled, updated_by)
       VALUES ($1, $2, $3, true, $4)`,
       [agentId, key_id, nextRank, actor.userId]
    );
    updated++;
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk add_fallback: key ${key_id} as fallback for ${updated} agent(s)`,
    entityType: "ai_automation_route",
    metadata: { action: "add_fallback", key_id, agent_ids, updated },
  });

  return NextResponse.json({
    action: "add_fallback",
    summary: `Added key ${key_id} as fallback for ${updated} agent(s)`,
    updated,
  });
}

async function handleReplaceKey(body: any, actor: { userId?: string; actorName: string }) {
  const { old_key_id, new_key_id } = body;
  if (!old_key_id || typeof old_key_id !== "string") {
    return NextResponse.json({ error: "old_key_id is required" }, { status: 400 });
  }
  if (!new_key_id || typeof new_key_id !== "string") {
    return NextResponse.json({ error: "new_key_id is required" }, { status: 400 });
  }

  const newKey = await queryOne<any>("SELECT id FROM ai_api_keys WHERE id = $1 AND is_enabled = true", [new_key_id]);
  if (!newKey) {
    return NextResponse.json({ error: "new_key_id not found or not enabled" }, { status: 400 });
  }

  const routes = await query<any>(
    "SELECT id, automation_id, rank, model_override FROM ai_automation_routes WHERE ai_key_id = $1",
    [old_key_id]
  );

  if (routes.length === 0) {
    return NextResponse.json({
      action: "replace_key",
      summary: "No routes found for old_key_id",
      updated: 0,
    });
  }

  const automationsAffected = new Set(routes.map((r: any) => r.automation_id));

  await execute(
    "DELETE FROM ai_automation_routes WHERE ai_key_id = $1",
    [old_key_id]
  );

  for (const r of routes) {
    const alreadyExists = await queryOne<any>(
      "SELECT id FROM ai_automation_routes WHERE automation_id = $1 AND ai_key_id = $2",
      [r.automation_id, new_key_id]
    );
    if (alreadyExists) continue;

    await execute(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, model_override, is_enabled, updated_by)
       VALUES ($1, $2, $3, $4, true, $5)`,
       [r.automation_id, new_key_id, r.rank, r.model_override, actor.userId]
    );
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk replace_key: replaced ${old_key_id} → ${new_key_id} across ${automationsAffected.size} agent(s) (${routes.length} routes)`,
    entityType: "ai_automation_route",
    metadata: { action: "replace_key", old_key_id, new_key_id, automations_affected: automationsAffected.size, routes_count: routes.length },
  });

  return NextResponse.json({
    action: "replace_key",
    summary: `Replaced key ${old_key_id} with ${new_key_id} across ${automationsAffected.size} agent(s) (${routes.length} routes)`,
    updated: routes.length,
    automations_affected: automationsAffected.size,
  });
}

async function handleRemoveKey(body: any, actor: { userId?: string; actorName: string }) {
  const { key_id, agent_ids } = body;
  if (!key_id || typeof key_id !== "string") {
    return NextResponse.json({ error: "key_id is required" }, { status: 400 });
  }
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids must be a non-empty array" }, { status: 400 });
  }

  let removed = 0;
  for (const agentId of agent_ids) {
    const result = await execute(
      "DELETE FROM ai_automation_routes WHERE automation_id = $1 AND ai_key_id = $2",
      [agentId, key_id]
    );
    removed += result.rowCount;
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "delete",
    description: `Bulk remove_key: removed key ${key_id} from ${agent_ids.length} agent(s) (${removed} routes deleted)`,
    entityType: "ai_automation_route",
    metadata: { action: "remove_key", key_id, agent_ids, removed },
  });

  return NextResponse.json({
    action: "remove_key",
    summary: `Removed key ${key_id} from ${agent_ids.length} agent(s) (${removed} routes deleted)`,
    removed,
  });
}

async function handleCopyRoutes(body: any, actor: { userId?: string; actorName: string }) {
  const { from_agent_id, to_agent_ids } = body;
  if (!from_agent_id || typeof from_agent_id !== "string") {
    return NextResponse.json({ error: "from_agent_id is required" }, { status: 400 });
  }
  if (!Array.isArray(to_agent_ids) || to_agent_ids.length === 0) {
    return NextResponse.json({ error: "to_agent_ids must be a non-empty array" }, { status: 400 });
  }

  const sourceRoutes = await query<any>(
    "SELECT * FROM ai_automation_routes WHERE automation_id = $1 ORDER BY rank",
    [from_agent_id]
  );

  if (sourceRoutes.length === 0) {
    return NextResponse.json(
      { error: `No routes found for source agent: ${from_agent_id}` },
      { status: 400 }
    );
  }

  let updated = 0;
  for (const targetId of to_agent_ids) {
    const auto = await queryOne<any>("SELECT id FROM ai_automations WHERE id = $1", [targetId]);
    if (!auto) continue;

    await execute("DELETE FROM ai_automation_routes WHERE automation_id = $1", [targetId]);

    for (const r of sourceRoutes) {
      await execute(
        `INSERT INTO ai_automation_routes (automation_id, ai_key_id, provider, rank, model_override, is_enabled, updated_by)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
         [targetId, r.ai_key_id, r.provider, r.rank, r.model_override, actor.userId]
      );
    }
    updated++;
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk copy_routes: copied ${sourceRoutes.length} route(s) from ${from_agent_id} to ${updated} agent(s)`,
    entityType: "ai_automation_route",
    metadata: { action: "copy_routes", from_agent_id, to_agent_ids, updated, source_route_count: sourceRoutes.length },
  });

  return NextResponse.json({
    action: "copy_routes",
    summary: `Copied ${sourceRoutes.length} route(s) from ${from_agent_id} to ${updated} agent(s)`,
    updated,
  });
}

async function handleDisableAgents(body: any, actor: { userId?: string; actorName: string }) {
  const { agent_ids } = body;
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids must be a non-empty array" }, { status: 400 });
  }

  let updated = 0;
  for (const agentId of agent_ids) {
    const result = await execute(
      "UPDATE ai_automations SET is_active = false WHERE id = $1 AND is_active = true",
      [agentId]
    );
    if (result.rowCount > 0) {
      await execute(
        "UPDATE ai_agent_configs SET is_active = false, updated_by = $1, updated_at = NOW() WHERE automation_id = $2 AND is_active = true",
        [actor.userId, agentId]
      );
      updated++;
    }
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk disable_agents: disabled ${updated} agent(s)`,
    entityType: "ai_automation",
    metadata: { action: "disable_agents", agent_ids, updated },
  });

  return NextResponse.json({
    action: "disable_agents",
    summary: `Disabled ${updated} agent(s)`,
    updated,
  });
}

async function handleEnableAgents(body: any, actor: { userId?: string; actorName: string }) {
  const { agent_ids } = body;
  if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids must be a non-empty array" }, { status: 400 });
  }

  let updated = 0;
  for (const agentId of agent_ids) {
    const result = await execute(
      "UPDATE ai_automations SET is_active = true WHERE id = $1 AND is_active = false",
      [agentId]
    );
    if (result.rowCount > 0) {
      await execute(
        "UPDATE ai_agent_configs SET is_active = true, updated_by = $1, updated_at = NOW() WHERE automation_id = $2 AND is_active = false",
        [actor.userId, agentId]
      );
      updated++;
    }
  }

  await logActivity({
    userId: actor.userId,
    actorName: actor.actorName,
    type: "update",
    description: `Bulk enable_agents: enabled ${updated} agent(s)`,
    entityType: "ai_automation",
    metadata: { action: "enable_agents", agent_ids, updated },
  });

  return NextResponse.json({
    action: "enable_agents",
    summary: `Enabled ${updated} agent(s)`,
    updated,
  });
}
