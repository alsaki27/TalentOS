// src/app/api/webhooks/[id]/events/route.ts
// GET -> delivery events for a specific webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { data, error } = await supabase
    .from("webhook_events")
    .select("*")
    .eq("endpoint_id", params.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
