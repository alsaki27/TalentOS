// PUT /api/admin/ai-automations/[id]/routes -> replace the full ordered route list for one automation
// Admin-only. Body: { routes: [{ ai_key_id?: string, provider?: string, rank: number }] }

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  // 1. Verify the automation exists
  const auto = await query(
    "SELECT id FROM ai_automations WHERE id = $1",
    [params.id]
  );
  if (auto.length === 0) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  // 2. Parse and validate body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inputRoutes: { ai_key_id?: string; provider?: string; rank: number }[] = body.routes;
  if (!Array.isArray(inputRoutes)) {
    return NextResponse.json({ error: "routes must be an array" }, { status: 400 });
  }

  // 3. Validate each route
  const ranks = new Set<number>();
  for (const r of inputRoutes) {
    if (typeof r.rank !== "number" || r.rank < 1) {
      return NextResponse.json(
        { error: `Invalid rank: ${r.rank}. Must be a positive integer.` },
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

    if (!r.ai_key_id && !r.provider) {
      return NextResponse.json(
        { error: `Route at rank ${r.rank} must specify ai_key_id or provider.` },
        { status: 400 }
      );
    }

    // If ai_key_id is provided, verify it exists
    if (r.ai_key_id) {
      const key = await query("SELECT id FROM ai_api_keys WHERE id = $1", [r.ai_key_id]);
      if (key.length === 0) {
        return NextResponse.json(
          { error: `AI key not found: ${r.ai_key_id}` },
          { status: 400 }
        );
      }
    }
  }

  // 4. Replace all routes in a single transaction
  await execute("DELETE FROM ai_automation_routes WHERE automation_id = $1", [params.id]);

  const userId = context?.profile.user_id;
  for (const r of inputRoutes) {
    await execute(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, provider, rank, updated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.id, r.ai_key_id ?? null, r.provider ?? null, r.rank, userId]
    );
  }

  // 5. Return updated routes
  const updated = await query(
    `SELECT ar.*, ak.label as key_label, ak.provider as key_provider
     FROM ai_automation_routes ar
     LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
     WHERE ar.automation_id = $1
     ORDER BY ar.rank`,
    [params.id]
  );

  return NextResponse.json({ routes: updated });
}
