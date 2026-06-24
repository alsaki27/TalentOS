// src/app/api/webhooks/[id]/events/route.ts
// GET -> delivery events for a specific webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await query(
      `SELECT * FROM webhook_events WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [params.id]
    );
    error = null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("webhook_events")
      .select("*")
      .eq("endpoint_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
