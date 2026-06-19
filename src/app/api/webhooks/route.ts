// src/app/api/webhooks/route.ts
// GET  -> list webhook endpoints (admin/manager only)
// POST -> create a new webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));

  let query = supabase
    .from("webhook_endpoints")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.name || !body.url) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      name: body.name,
      url: body.url,
      secret: body.secret ?? null,
      events: body.events ?? [],
      status: body.status ?? "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
