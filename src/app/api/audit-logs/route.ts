// src/app/api/audit-logs/route.ts
// GET -> recent audit_logs entries, admin-only. Routes across the app write here
// (user.created, application.created, etc. — see src/lib/auth.ts callers) but until now
// nothing read it back.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const action = url.searchParams.get("action") || "";
  const entityType = url.searchParams.get("entityType") || "";

  const from = (page - 1) * PAGE_SIZE;

  if (isNeon()) {
    const whereClauses: string[] = [];
    const params: string[] = [];
    if (action) { whereClauses.push(`action = $${params.length + 1}`); params.push(action); }
    if (entityType) { whereClauses.push(`entity_type = $${params.length + 1}`); params.push(entityType); }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countRes = await queryOne<{total: number}>(`SELECT COUNT(*)::int as total FROM audit_logs ${where}`, params);
    const logs = await query<any>(`SELECT id, actor_user_id, actor_email, action, entity_type, entity_id, metadata, created_at FROM audit_logs ${where} ORDER BY created_at DESC OFFSET $${params.length + 1} LIMIT $${params.length + 2}`, [...params, from, PAGE_SIZE]);

    return NextResponse.json({ logs: logs ?? [], total: countRes?.total ?? 0, page, pageSize: PAGE_SIZE });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let query = supabase
      .from("audit_logs")
      .select("id, actor_user_id, actor_email, action, entity_type, entity_id, metadata, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    if (action) query = query.eq("action", action);
    if (entityType) query = query.eq("entity_type", entityType);

    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ logs: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
  }
}
