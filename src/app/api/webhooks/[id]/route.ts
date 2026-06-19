// src/app/api/webhooks/[id]/route.ts
// PATCH  -> update a webhook endpoint
// DELETE -> remove a webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = ["name", "url", "secret", "events", "status"];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
