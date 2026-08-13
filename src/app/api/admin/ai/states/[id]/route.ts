import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { sanitizeApiError } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
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
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const body = await req.json();
    const status = body.status;
    if (!['draft', 'published', 'archived'].includes(status)) return NextResponse.json({ error: "status must be draft, published, or archived" }, { status: 400 });
    const state = status === "published"
      ? await queryOne<any>(
          `WITH guard AS (
             SELECT pg_advisory_xact_lock(hashtext('ai-routing-state-publish'))
           ), target AS (
             SELECT s.id FROM ai_routing_states s CROSS JOIN guard WHERE s.id = $1
           ), archived AS (
             UPDATE ai_routing_states SET status = 'archived', updated_at = now()
             WHERE status = 'published' AND id <> $1 AND EXISTS (SELECT 1 FROM target)
           ), published AS (
             UPDATE ai_routing_states s
             SET status = 'published', published_at = now(), updated_at = now()
             FROM target t WHERE s.id = t.id RETURNING s.*
           ), activated AS (
             INSERT INTO ai_runtime_config (singleton, active_routing_state_id, updated_by, updated_at)
             SELECT true, id, $2, now() FROM published
             ON CONFLICT (singleton) DO UPDATE
               SET active_routing_state_id = EXCLUDED.active_routing_state_id,
                   updated_by = EXCLUDED.updated_by, updated_at = now()
           ) SELECT * FROM published`,
          [params.id, context?.profile.user_id ?? null]
        )
      : await queryOne<any>(`UPDATE ai_routing_states
          SET status = $2, updated_at = now()
          WHERE id = $1
            AND id IS DISTINCT FROM (SELECT active_routing_state_id FROM ai_runtime_config WHERE singleton = true)
          RETURNING *`, [params.id, status]);
    if (!state) {
      const exists = await queryOne<{ id: string }>("SELECT id FROM ai_routing_states WHERE id = $1", [params.id]);
      if (exists && status !== "published") {
        return NextResponse.json(
          { error: "The active routing state cannot be archived or returned to draft. Publish another state first." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Routing state not found" }, { status: 404 });
    }
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
