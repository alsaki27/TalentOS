// src/app/api/ops/digests/route.ts
// GET  -> recent stored digests (admin-only)
// POST -> generate one right now, on demand

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { generateDailyDigest } from "@/lib/ai/digest";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { data, error } = await supabase
    .from("ai_digests")
    .select("id, content, provider, generated_at")
    .order("generated_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const result = await generateDailyDigest();
  if ("error" in result) return NextResponse.json(result, { status: 502 });

  const { data, error } = await supabase
    .from("ai_digests")
    .insert({ content: result.content, provider: result.provider })
    .select("id, content, provider, generated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
