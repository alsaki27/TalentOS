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
    // Publishing is an operational action, not just a label. Previously this
    // endpoint only changed the state metadata, so the UI could say
    // "published" while the live resolver continued using the old routes.
    // Apply the snapshot in the same database-side operation as the publish.
    if (status === "published") {
      await execute(`WITH published AS (
        UPDATE ai_routing_states
        SET status = 'published', published_at = COALESCE(published_at, now()), updated_at = now()
        WHERE id = $1
        RETURNING id
      ), snapshot AS (
        SELECT r.automation_id, r.rank, r.ai_key_id, r.provider, r.model_override, r.is_enabled
        FROM ai_routing_state_routes r
        JOIN published p ON p.id = r.state_id
      )
      UPDATE ai_automation_routes live
      SET ai_key_id = snapshot.ai_key_id,
          provider = snapshot.provider,
          model_override = snapshot.model_override,
          is_enabled = snapshot.is_enabled,
          updated_at = now()
      FROM snapshot
      WHERE snapshot.automation_id = live.automation_id
        AND snapshot.rank = live.rank`, [params.id]);
    } else {
      await execute(`UPDATE ai_routing_states
        SET status = $2, updated_at = now()
        WHERE id = $1`, [params.id, status]);
    }
    const state = await queryOne<any>("SELECT * FROM ai_routing_states WHERE id = $1", [params.id]);
    if (!state) return NextResponse.json({ error: "Routing state not found" }, { status: 404 });
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
