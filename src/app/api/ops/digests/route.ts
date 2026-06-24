// src/app/api/ops/digests/route.ts
// GET  -> recent stored digests (admin-only)
// POST -> generate one right now, on demand

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { generateDailyDigest } from "@/lib/ai/digest";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  let data: any[];
  let error: any;

  if (isNeon()) {
    data = await query(
      `SELECT id, content, provider, generated_at FROM ai_digests ORDER BY generated_at DESC LIMIT 10`,
      []
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("ai_digests")
      .select("id, content, provider, generated_at")
      .order("generated_at", { ascending: false })
      .limit(10);
    data = res.data ?? [];
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const result = await generateDailyDigest();
  if ("error" in result) return NextResponse.json(result, { status: 502 });

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO ai_digests (content, provider) VALUES ($1, $2) RETURNING id, content, provider, generated_at`,
      [result.content, result.provider]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("ai_digests")
      .insert({ content: result.content, provider: result.provider })
      .select("id, content, provider, generated_at")
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
