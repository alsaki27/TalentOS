import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const AI_ENTITY_TYPES = [
  "ai_api_key",
  "ai_automation",
  "ai_automation_route",
  "ai_agent_config",
];

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
    const type = url.searchParams.get("type") || "";
    const entityType = url.searchParams.get("entityType") || "";

    const conditions: string[] = [
      `entity_type = ANY($1)`,
    ];
    const params: unknown[] = [AI_ENTITY_TYPES];
    let idx = 2;

    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    if (entityType) {
      conditions.push(`entity_type = $${idx++}`);
      params.push(entityType);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const offset = (page - 1) * pageSize;

    const countRes = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM activity_logs ${where}`,
      params
    );

    const events = await query<any>(
      `SELECT
         id, user_id, actor_name, type, description,
         entity_type, entity_id, entity_name,
         metadata, created_at
       FROM activity_logs
       ${where}
       ORDER BY created_at DESC
       OFFSET $${idx++} LIMIT $${idx++}`,
      [...params, offset, pageSize]
    );

    return NextResponse.json({
      events: events.map((e: any) => ({
        id: e.id,
        userId: e.user_id,
        actorName: e.actor_name,
        type: e.type,
        description: e.description,
        entityType: e.entity_type,
        entityId: e.entity_id,
        entityName: e.entity_name,
        metadata: e.metadata ?? {},
        createdAt: e.created_at,
      })),
      total: countRes?.total ?? 0,
      page,
    });
  } catch (err: any) {
    console.error("[ai/audit]", err.message || err);
    return NextResponse.json(
      { error: "Failed to load audit data" },
      { status: 500 }
    );
  }
}
