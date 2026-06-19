// src/app/api/email-logs/[id]/track/route.ts
// PATCH -> track open/click (update opened_at, clicked_at)

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();

  const updates: Record<string, any> = {};
  if (body.opened_at) {
    updates.opened_at = body.opened_at;
    updates.status = "opened";
  }
  if (body.clicked_at) {
    updates.clicked_at = body.clicked_at;
    updates.status = "clicked";
  }
  if (body.replied_at) {
    updates.replied_at = body.replied_at;
    updates.status = "replied";
  }

  const { data, error } = await supabase
    .from("email_logs")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
