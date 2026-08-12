import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, query, queryOne } from "@/server/db/neon";
import { sanitizeApiError } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const state = await queryOne<any>("SELECT * FROM ai_routing_states WHERE id = $1", [params.id]);
    if (!state) return NextResponse.json({ error: "Routing state not found" }, { status: 404 });
    const routes = await query<any>(`SELECT r.*, a.label AS automation_label, k.label AS key_label,
      k.provider AS key_provider, k.model AS key_model
      FROM ai_routing_state_routes r JOIN ai_automations a ON a.id = r.automation_id
      LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
      WHERE r.state_id = $1 ORDER BY a.group_label, a.label, r.rank`, [params.id]);
    return NextResponse.json({ state, routes });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const body = await req.json();
    const status = body.status;
    if (!['draft', 'published', 'archived'].includes(status)) return NextResponse.json({ error: "status must be draft, published, or archived" }, { status: 400 });
    const state = await queryOne<any>(`UPDATE ai_routing_states
      SET status = $2, published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END, updated_at = now()
      WHERE id = $1 RETURNING *`, [params.id, status]);
    if (!state) return NextResponse.json({ error: "Routing state not found" }, { status: 404 });
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
