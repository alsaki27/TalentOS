// src/app/api/webhooks/[id]/test/route.ts
// POST -> send a test event to a webhook endpoint

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { deliverWebhook } from "@/lib/webhookEngine";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const { data: endpoint, error } = await supabase
    .from("webhook_endpoints")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !endpoint) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const result = await deliverWebhook(endpoint, "webhook.test", {
    message: "This is a test event from TalentOS.",
    endpoint_id: endpoint.id,
    endpoint_name: endpoint.name,
  });

  return NextResponse.json(result);
}
