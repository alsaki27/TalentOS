// src/app/api/admin/ai-task-routing/route.ts
// GET -> list all per-category AI provider routing configs
// PUT -> update (upsert) a category's provider/key mapping

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, execute } from "@/server/db/neon";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    let rows: any[] = [];

    if (isNeon()) {
      rows = await query(
        `SELECT c.category, c.provider, c.ai_key_id, c.updated_at,
                k.label AS ai_key_label, k.provider AS ai_key_provider
         FROM ai_task_category_config c
         LEFT JOIN ai_api_keys k ON k.id = c.ai_key_id`,
        []
      );
    } else {
      const { data } = await supabase
        .from("ai_task_category_config")
        .select("category, provider, ai_key_id, updated_at, ai_api_keys(label, provider)")
        .order("category");
      rows = data ?? [];
    }

    return NextResponse.json({ configs: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const category = typeof body.category === "string" ? body.category.trim() : "";
  const provider = body.provider === null || body.provider === undefined ? null : typeof body.provider === "string" ? body.provider.trim() : null;
  const aiKeyId = body.aiKeyId === null || body.aiKeyId === undefined ? null : typeof body.aiKeyId === "string" ? body.aiKeyId.trim() : null;

  const validCategories = [
    "resume_studio",
    "chat_assistant",
    "parsing_extraction",
    "content_generation",
    "default",
  ];
  if (!validCategories.includes(category)) {
    return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
  }

  if (provider && !["anthropic", "nvidia", "openai", "glm", "google", "google_vertex_proxy"].includes(provider)) {
    return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 });
  }

  try {
    if (isNeon()) {
      await execute(
        `INSERT INTO ai_task_category_config (category, provider, ai_key_id, updated_at, updated_by)
         VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (category) DO UPDATE
         SET provider = EXCLUDED.provider,
             ai_key_id = EXCLUDED.ai_key_id,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by`,
        [category, provider, aiKeyId, context?.profile.user_id ?? null]
      );
    } else {
      const { error } = await supabase
        .from("ai_task_category_config")
        .upsert({
          category,
          provider,
          ai_key_id: aiKeyId,
          updated_at: new Date().toISOString(),
          updated_by: context?.profile.user_id ?? null,
        }, { onConflict: "category" });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ success: true, category, provider, aiKeyId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
