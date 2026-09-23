import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, query } from "@/server/db/neon";
import { sanitizeApiError } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const states = await query<any>(`SELECT s.*, COUNT(r.*)::int AS route_count,
      (s.id = c.active_routing_state_id) AS is_active
      FROM ai_routing_states s LEFT JOIN ai_routing_state_routes r ON r.state_id = s.id
      LEFT JOIN ai_runtime_config c ON c.singleton = true
      GROUP BY s.id, c.active_routing_state_id ORDER BY s.updated_at DESC`);
    return NextResponse.json({ states });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return NextResponse.json({ error: "A state name (1–120 characters) is required." }, { status: 400 });
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const sourceId = typeof body.sourceStateId === "string" ? body.sourceStateId : null;
    const actor = context?.profile.user_id ?? null;
    const created = await query<any>(`INSERT INTO ai_routing_states (name, description, status, created_by)
      VALUES ($1, $2, 'draft', $3) RETURNING *`, [name, description, actor]);
    const state = created[0];
    if (sourceId) {
      await execute(`INSERT INTO ai_routing_state_routes
        (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
        SELECT $1, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled
        FROM ai_routing_state_routes WHERE state_id = $2`, [state.id, sourceId]);
    } else {
      await execute(`INSERT INTO ai_routing_state_routes
        (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
        SELECT $1, automation_id, rank, ai_key_id, provider, model_override, NULL, is_enabled
        FROM ai_automation_routes`, [state.id]);
    }
    return NextResponse.json({ state }, { status: 201 });
  } catch (err: any) {
    const status = String(err?.code) === "23505" ? 409 : 500;
    return NextResponse.json({ error: String(err?.code) === "23505" ? "A state with that name already exists." : sanitizeApiError(err) }, { status });
  }
}
