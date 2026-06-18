import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:read");
  if (response) return response;

  const { data, error } = await supabase.from("integration_events").select("*").eq("id", params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:acknowledge");
  if (response) return response;

  const body = await req.json();
  const { data, error } = await supabase
    .from("integration_events")
    .update({
      acknowledged_at: body.acknowledged_at || new Date().toISOString(),
      acknowledged_by: body.acknowledged_by || "Public API",
      acknowledgement_note: body.acknowledgement_note || null,
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
