// src/app/api/import-sources/route.ts
// GET  -> list saved schedulable import sources
// POST -> save a new one (run manually from /import-sources, or picked up by the
// /api/cron/import-sources job on a schedule)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const PROVIDERS = ["greenhouse", "lever", "ashby", "usajobs", "career_page"] as const;

export async function GET() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("import_sources")
    .select("*")
    .order("created_at", { ascending: false });

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

  const { data, error } = await supabase
    .from("import_sources")
    .insert({ label, provider, token_or_url: tokenOrUrl })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
