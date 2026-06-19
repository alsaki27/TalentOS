// src/app/api/activity/route.ts
// GET  -> list activity logs (with pagination, filter by type/entity)
// POST -> create an activity log entry (internal use)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  let query = supabase
    .from("activity_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (type) query = query.eq("type", type);
  if (entityType) query = query.eq("entity_type", entityType);
  if (entityId) query = query.eq("entity_id", entityId);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

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
