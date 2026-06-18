// src/app/api/candidates/route.ts
// GET  -> list all candidates
// POST -> create a new candidate

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "100", 10) || 100));
  const columns = compact
    ? "id, name, resume_url, resume_filename"
    : "id, name, email, phone, status, target_tier, resume_filename, avatar_url, created_at";

  const from = (page - 1) * pageSize;
  const { data, error } = await supabase
    .from("candidates")
    .select(columns)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
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
  return NextResponse.json(data, { status: 201 });
}
