import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:read");
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne('SELECT * FROM integration_events WHERE id = $1', [params.id]);
    error = data ? null : { message: 'Not found' };
  } else {
    const res = await supabase.from("integration_events").select("*").eq("id", params.id).single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:acknowledge");
  if (response) return response;

  const body = await req.json();

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `UPDATE integration_events
       SET acknowledged_at = $1, acknowledged_by = $2, acknowledgement_note = $3
       WHERE id = $4 RETURNING *`,
      [
        body.acknowledged_at || new Date().toISOString(),
        body.acknowledged_by || "Public API",
        body.acknowledgement_note || null,
        params.id,
      ]
    );
    error = data ? null : { message: 'Update failed' };
  } else {
    const res = await supabase
      .from("integration_events")
      .update({
        acknowledged_at: body.acknowledged_at || new Date().toISOString(),
        acknowledged_by: body.acknowledged_by || "Public API",
        acknowledgement_note: body.acknowledgement_note || null,
      })
      .eq("id", params.id)
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
