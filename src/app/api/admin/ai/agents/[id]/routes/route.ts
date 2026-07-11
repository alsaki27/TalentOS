import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const auto = await queryOne<any>(
    "SELECT id FROM ai_automations WHERE id = $1",
    [params.id]
  );
  if (!auto) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  const routes = await query<any>(
    `SELECT ar.*, ak.label as key_label, ak.provider as key_provider,
            ak.model as key_model, ak.key_fingerprint, ak.status as key_status
     FROM ai_automation_routes ar
     LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
     WHERE ar.automation_id = $1
     ORDER BY ar.rank`,
    [params.id]
  );

  return NextResponse.json({ routes });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const auto = await queryOne<any>(
    "SELECT id FROM ai_automations WHERE id = $1",
    [params.id]
  );
  if (!auto) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inputRoutes: { ai_key_id: string; model_override?: string; rank: number }[] = body.routes;
  if (!Array.isArray(inputRoutes) || inputRoutes.length === 0) {
    return NextResponse.json({ error: "routes must be a non-empty array" }, { status: 400 });
  }

  const ranks = new Set<number>();
  const keyIds = new Set<string>();

  for (const r of inputRoutes) {
    if (typeof r.rank !== "number" || r.rank < 0) {
      return NextResponse.json(
        { error: `Invalid rank: ${r.rank}. Must be a non-negative integer.` },
        { status: 400 }
      );
    }
    if (ranks.has(r.rank)) {
      return NextResponse.json(
        { error: `Duplicate rank: ${r.rank}. Ranks must be unique.` },
        { status: 400 }
      );
    }
    ranks.add(r.rank);

    if (!r.ai_key_id || typeof r.ai_key_id !== "string") {
      return NextResponse.json(
        { error: `Route at rank ${r.rank} must specify a valid ai_key_id.` },
        { status: 400 }
      );
    }
    if (keyIds.has(r.ai_key_id)) {
      return NextResponse.json(
        { error: `Duplicate key in chain: ${r.ai_key_id}. Each key can only appear once.` },
        { status: 400 }
      );
    }
    keyIds.add(r.ai_key_id);
  }

  const existingKeys = await query<any>(
    "SELECT id FROM ai_api_keys WHERE id = ANY($1) AND is_enabled = true",
    [[...keyIds]]
  );
  const existingKeyIds = new Set(existingKeys.map((k: any) => k.id));
  for (const keyId of keyIds) {
    if (!existingKeyIds.has(keyId)) {
      return NextResponse.json(
        { error: `AI key not found or not enabled: ${keyId}` },
        { status: 400 }
      );
    }
  }

  await execute("DELETE FROM ai_automation_routes WHERE automation_id = $1", [params.id]);

  const userId = context?.profile.user_id;
  for (const r of inputRoutes) {
    await execute(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, model_override, is_enabled, updated_by)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [params.id, r.ai_key_id, r.rank, r.model_override ?? null, userId]
    );
  }

  const updated = await query<any>(
    `SELECT ar.*, ak.label as key_label, ak.provider as key_provider,
            ak.model as key_model, ak.key_fingerprint, ak.status as key_status
     FROM ai_automation_routes ar
     LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
     WHERE ar.automation_id = $1
     ORDER BY ar.rank`,
    [params.id]
  );

  return NextResponse.json({ routes: updated });
}
