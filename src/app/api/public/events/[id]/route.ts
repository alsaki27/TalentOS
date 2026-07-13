import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:read");
  if (response) return response;

  const data = await queryOne('SELECT * FROM integration_events WHERE id = $1', [params.id]);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "events:acknowledge");
  if (response) return response;

  const body = await req.json();

  const data = await queryOne(
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
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(data);
}
