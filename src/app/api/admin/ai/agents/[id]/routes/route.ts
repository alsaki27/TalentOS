import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeApiError } from "@/lib/utils";
import { sql as getSql, query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const auto = await queryOne<any>(
    "SELECT id, route_version FROM ai_automations WHERE id = $1",
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

  return NextResponse.json({ routes, routeVersion: auto.route_version ?? 1 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { context, response } = await requireCurrentUser(["admin"]);
    if (response) return response;

    const auto = await queryOne<any>(
      "SELECT id, route_version FROM ai_automations WHERE id = $1",
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

    const clientVersion: number | undefined = body.routeVersion;
    const currentVersion: number = auto.route_version ?? 1;
    if (clientVersion !== undefined && clientVersion !== currentVersion) {
      return NextResponse.json(
        { error: "Another admin modified these routes. Please refresh and try again.", currentRouteVersion: currentVersion },
        { status: 409 }
      );
    }

    const ranks = new Set<number>();
    const keyIds = new Set<string>();
    const warnings: string[] = [];

    for (const r of inputRoutes) {
      if (typeof r.rank !== "number" || r.rank < 1) {
        return NextResponse.json(
          { error: `Invalid rank: ${r.rank}. Must be a positive integer (1-based).` },
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
      "SELECT id, provider FROM ai_api_keys WHERE id = ANY($1) AND is_enabled = true",
      [[...keyIds]]
    );
    const existingKeyIds = new Set(existingKeys.map((k: any) => k.id));
    const keyProviders = new Map<string, string>(existingKeys.map((k: any) => [k.id, k.provider]));
    for (const keyId of keyIds) {
      if (!existingKeyIds.has(keyId)) {
        return NextResponse.json(
          { error: `AI key not found or not enabled: ${keyId}` },
          { status: 400 }
        );
      }
    }

    const confusionPairs: Array<{ provider: string; likelyPrefix: string; badPrefix: string; badFrom: string }> = [
      { provider: "openai", likelyPrefix: "gpt-", badPrefix: "claude-", badFrom: "Anthropic (Claude)" },
      { provider: "anthropic", likelyPrefix: "claude-", badPrefix: "gpt-", badFrom: "OpenAI (GPT)" },
      { provider: "google", likelyPrefix: "gemini-", badPrefix: "claude-", badFrom: "Anthropic (Claude)" },
      { provider: "google_vertex_proxy", likelyPrefix: "gemini-", badPrefix: "claude-", badFrom: "Anthropic (Claude)" },
      { provider: "google", likelyPrefix: "gemini-", badPrefix: "gpt-", badFrom: "OpenAI (GPT)" },
      { provider: "google_vertex_proxy", likelyPrefix: "gemini-", badPrefix: "gpt-", badFrom: "OpenAI (GPT)" },
      { provider: "anthropic", likelyPrefix: "claude-", badPrefix: "gemini-", badFrom: "Google (Gemini)" },
      { provider: "openai", likelyPrefix: "gpt-", badPrefix: "gemini-", badFrom: "Google (Gemini)" },
    ];

    for (const r of inputRoutes) {
      const modelToCheck = r.model_override;
      if (!modelToCheck) continue;
      const provider = keyProviders.get(r.ai_key_id);
      if (!provider) continue;
      const lowerModel = modelToCheck.toLowerCase();
      const lowerProvider = provider.toLowerCase();

      for (const pair of confusionPairs) {
        if (lowerProvider === pair.provider && lowerModel.startsWith(pair.badPrefix)) {
          warnings.push(
            `Route rank ${r.rank}: model "${modelToCheck}" starts with "${pair.badPrefix}" but the key is on provider "${pair.provider}". This model may belong to ${pair.badFrom}.`
          );
          break;
        }
      }
    }

    const oldRoutes = await query<any>(
      `SELECT ar.*, ak.label as key_label, ak.provider as key_provider,
              ak.model as key_model, ak.key_fingerprint, ak.status as key_status
       FROM ai_automation_routes ar
       LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
       WHERE ar.automation_id = $1
       ORDER BY ar.rank`,
      [params.id]
    );

    const newVersion = currentVersion + 1;
    const userId = context?.profile.user_id;

    const sql = getSql();

    try {
      const queries = [
        sql.query("DELETE FROM ai_automation_routes WHERE automation_id = $1", [params.id]),
        ...inputRoutes.map((r) =>
          sql.query(
            `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, model_override, is_enabled, updated_by)
             VALUES ($1, $2, $3, $4, true, $5)`,
            [params.id, r.ai_key_id, r.rank, r.model_override ?? null, userId]
          )
        ),
        sql.query(
          "UPDATE ai_automations SET route_version = $1, updated_at = NOW() WHERE id = $2",
          [newVersion, params.id]
        ),
      ];

      await sql.transaction(queries);
    } catch (insertErr: any) {
      console.error("[routes:PUT] transaction failed:", insertErr?.message);
      return NextResponse.json(
        { error: "Failed to update routes.", detail: sanitizeApiError(insertErr) },
        { status: 500 }
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

    // Best-effort: the route change above already committed. A logging
    // failure here must not make an already-successful save report as a
    // 500 to the client (this is exactly how the entity_id uuid/text
    // mismatch bug, sql/neon_fixes/020, masked working saves as failures).
    try {
      await logActivity({
        userId: context?.profile.user_id,
        actorName: context?.profile.display_name || context?.profile.email || "Admin",
        type: "update",
        description: `Updated routing for ${params.id}: ${oldRoutes.length} → ${updated.length} routes`,
        entityType: "ai_automation_route",
        entityId: params.id,
        entityName: `Routes for ${params.id}`,
        metadata: {
          before: oldRoutes.map((r: any) => ({ key: r.ai_key_id, rank: r.rank, model: r.model_override })),
          after: updated.map((r: any) => ({ key: r.ai_key_id, rank: r.rank, model: r.model_override })),
        },
      });
    } catch (logErr: any) {
      console.error("[routes:PUT] logActivity failed (non-fatal):", logErr?.message);
    }

    return NextResponse.json({ routes: updated, routeVersion: newVersion, warnings });
  } catch (err: any) {
    console.error("[routes:PUT] Validation failed:", err.message);
    return NextResponse.json(
      { error: sanitizeApiError(err) },
      { status: 500 }
    );
  }
}
