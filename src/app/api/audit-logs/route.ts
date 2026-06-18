// src/app/api/audit-logs/route.ts
// GET -> recent audit_logs entries, admin-only. Routes across the app write here
// (user.created, application.created, etc. — see src/lib/auth.ts callers) but until now
// nothing read it back.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const action = url.searchParams.get("action") || "";
  const entityType = url.searchParams.get("entityType") || "";

  let query = supabase
    .from("audit_logs")
    .select("id, actor_user_id, actor_email, action, entity_type, entity_id, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
}
