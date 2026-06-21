// src/app/api/activity/route.ts
// GET  -> list activity logs (with pagination, filter by type/entity)
// POST -> create an activity log entry (internal use)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || String(PAGE_SIZE), 10) || PAGE_SIZE));
  const type = url.searchParams.get("type") || "";
  const entityType = url.searchParams.get("entityType") || "";
  const entityId = url.searchParams.get("entityId") || "";

  const from = (page - 1) * pageSize;

  if (isNeon()) {
    const whereClauses: string[] = [];
    const params: (string | null | object)[] = [];
    if (type) { whereClauses.push(`type = $${params.length + 1}`); params.push(type); }
    if (entityType) { whereClauses.push(`entity_type = $${params.length + 1}`); params.push(entityType); }
    if (entityId) { whereClauses.push(`entity_id = $${params.length + 1}`); params.push(entityId); }

    const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await queryOne<{total: number}>(`SELECT COUNT(*)::int as total FROM activity_logs ${where}`, params);
    const logs = await query<any>(`SELECT * FROM activity_logs ${where} ORDER BY created_at DESC OFFSET $${params.length + 1} LIMIT $${params.length + 2}`, [...params, from, pageSize]);

    return NextResponse.json({ logs: logs ?? [], total: countRes?.total ?? 0, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (type) query = query.eq("type", type);
    if (entityType) query = query.eq("entity_type", entityType);
    if (entityId) query = query.eq("entity_id", entityId);

    const { data, error, count } = await query.range(from, from + pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ logs: data ?? [], total: count ?? 0, page, pageSize });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  if (isNeon()) {
    const log = await queryOne<any>(`INSERT INTO activity_logs (user_id, actor_name, actor_type, type, description, entity_type, entity_id, entity_name, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [
      body.user_id ?? null,
      body.actor_name ?? null,
      body.actor_type ?? "user",
      body.type,
      body.description,
      body.entity_type ?? null,
      body.entity_id ?? null,
      body.entity_name ?? null,
      body.metadata ?? {},
    ]);
    return NextResponse.json(log, { status: 201 });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("activity_logs")
      .insert({
        user_id: body.user_id ?? null,
        actor_name: body.actor_name ?? null,
        actor_type: body.actor_type ?? "user",
        type: body.type,
        description: body.description,
        entity_type: body.entity_type ?? null,
        entity_id: body.entity_id ?? null,
        entity_name: body.entity_name ?? null,
        metadata: body.metadata ?? {},
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }
}
