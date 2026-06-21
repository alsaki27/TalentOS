// src/app/api/webhooks/route.ts
// GET  -> list webhook endpoints (admin/manager only)
// POST -> create a new webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));

  const from = (page - 1) * pageSize;

  let data: any;
  let error: any;
  let count: number = 0;

  if (isNeon()) {
    const countResult = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM webhook_endpoints`,
      []
    );
    count = countResult?.total ?? 0;
    data = await query(
      `SELECT * FROM webhook_endpoints ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, from]
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    let sbQuery = supabase
      .from("webhook_endpoints")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    const res = await sbQuery.range(from, from + pageSize - 1);
    data = res.data;
    error = res.error;
    count = res.count ?? 0;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data ?? [], total: count, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.name || !body.url) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO webhook_endpoints (name, url, secret, events, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.url, body.secret ?? null, body.events ?? [], body.status ?? "active"]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
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
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
