// src/app/api/ops/backups/route.ts
// GET -> list recent stored backup snapshots (admin-only), newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { data, error } = await supabase.storage
    .from("resumes")
    .list("backups", { limit: 20, sortBy: { column: "name", order: "desc" } });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data ?? []).map((f: any) => ({ name: f.name as string, createdAt: f.created_at as string, sizeBytes: f.metadata?.size ?? null })));
}

export async function POST() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  return NextResponse.json({ error: "Use POST /api/ops/restore for backup restores." }, { status: 405 });
}
