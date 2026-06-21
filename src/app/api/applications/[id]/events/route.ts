// src/app/api/applications/[id]/events/route.ts
// GET -> status-change timeline for one application

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (isNeon()) {
    const data = await query<Record<string, any>>(
      'SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at ASC LIMIT 100',
      [params.id]
    );
    return NextResponse.json(data);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("application_events")
      .select("*")
      .eq("application_id", params.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
}
