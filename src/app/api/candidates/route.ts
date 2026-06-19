// src/app/api/candidates/route.ts
// GET  -> paginated/filterable list of candidates
// POST -> create a new candidate

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const tier = url.searchParams.get("tier") || "";

  const columns = compact
    ? "id, name, resume_url, resume_filename"
    : "id, name, email, phone, status, target_tier, resume_filename, avatar_url, created_at";

  let query = supabase.from("candidates").select(columns, { count: "exact" });

  if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  if (status) query = query.eq("status", status);
  if (tier) query = query.eq("target_tier", tier);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("candidates")
    .insert({
      name: body.name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      status: body.status ?? "active",
      target_tier: body.target_tier ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context && data) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "create",
      description: `Created candidate ${data.name}`,
      entityType: "candidate",
      entityId: data.id,
      entityName: data.name,
    });
    void triggerWebhooks("candidate.created", {
      candidate_id: data.id,
      name: data.name,
      email: data.email,
      created_by: context.profile.user_id,
    });
  }

  return NextResponse.json(data, { status: 201 });
}
