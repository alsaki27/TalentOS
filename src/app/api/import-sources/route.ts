// src/app/api/import-sources/route.ts
// GET  -> list saved schedulable import sources
// POST -> save a new one (run manually from /import-sources, or picked up by the
// /api/cron/import-sources job on a schedule)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

const PROVIDERS = ["greenhouse", "lever", "ashby", "usajobs", "career_page"] as const;

export async function GET() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await query(`SELECT * FROM import_sources ORDER BY created_at DESC`);
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("import_sources")
      .select("*")
      .order("created_at", { ascending: false });
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const label = body.label?.trim();
  const provider = body.provider;
  const tokenOrUrl = body.token_or_url?.trim();

  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "provider must be one of: " + PROVIDERS.join(", ") }, { status: 400 });
  }
  if (!tokenOrUrl) return NextResponse.json({ error: "token_or_url is required" }, { status: 400 });

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await queryOne(
        `INSERT INTO import_sources (label, provider, token_or_url) VALUES ($1, $2, $3) RETURNING *`,
        [label, provider, tokenOrUrl]
      );
      error = data ? null : { message: "Insert failed" };
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("import_sources")
      .insert({ label, provider, token_or_url: tokenOrUrl })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
