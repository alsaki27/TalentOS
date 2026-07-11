import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { query, queryOne, execute } from "@/server/db/neon";
import {
  updateAiKey,
} from "@/server/repositories/aiKeyRepository";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    const key = await queryOne<any>(
      `SELECT
         ak.*,
         COALESCE(ue.today_calls, 0)::int as today_calls,
         COALESCE(ue.today_tokens, 0)::int as today_tokens,
         COALESCE(ue.today_cost, 0)::numeric as today_cost,
         COALESCE(ar.assignment_count, 0)::int as assignment_count
       FROM ai_api_keys ak
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*)::int as today_calls,
           COALESCE(SUM(input_tokens + COALESCE(output_tokens, 0)), 0)::int as today_tokens,
           COALESCE(SUM(estimated_cost_usd), 0)::numeric as today_cost
         FROM ai_usage_events
         WHERE created_at >= CURRENT_DATE
         GROUP BY ai_key_id
       ) ue ON ak.id = ue.ai_key_id
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*)::int as assignment_count
         FROM ai_automation_routes
         WHERE is_enabled = true
         GROUP BY ai_key_id
       ) ar ON ak.id = ar.ai_key_id
       WHERE ak.id = $1`,
      [id]
    );

    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const routes = await query<any>(
      `SELECT ar.*, a.label as automation_label, a.description as automation_description, a.group_label as automation_group
       FROM ai_automation_routes ar
       LEFT JOIN ai_automations a ON ar.automation_id = a.id
       WHERE ar.ai_key_id = $1
       ORDER BY ar.rank ASC`,
      [id]
    );

    return NextResponse.json({
      key: {
        ...key,
        routes,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const standardUpdates: {
    label?: string;
    model?: string | null;
    priority?: number;
    is_enabled?: boolean;
    apiKey?: string;
  } = {};

  if (body.label !== undefined) standardUpdates.label = body.label;
  if (body.model !== undefined) standardUpdates.model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  if (body.priority !== undefined) standardUpdates.priority = body.priority;
  if (body.is_enabled !== undefined) standardUpdates.is_enabled = body.is_enabled;
  if (body.apiKey !== undefined) {
    if (!isEncryptionAvailable()) {
      return NextResponse.json(
        { error: "AI key encryption is not configured. Set AI_KEYS_ENCRYPTION_SECRET to replace API keys." },
        { status: 503 }
      );
    }
    standardUpdates.apiKey = body.apiKey;
  }

  const hasStandardUpdates = Object.keys(standardUpdates).length > 0;

  const extraFields: string[] = [];
  const extraValues: any[] = [];
  let extraIdx = 1;

  if (body.base_url !== undefined) {
    extraFields.push(`base_url = $${extraIdx++}`);
    extraValues.push(typeof body.base_url === "string" && body.base_url.trim() ? body.base_url.trim() : null);
  }
  if (body.notes !== undefined) {
    extraFields.push(`notes = $${extraIdx++}`);
    extraValues.push(typeof body.notes === "string" ? body.notes : null);
  }
  if (body.daily_request_limit !== undefined) {
    extraFields.push(`daily_request_limit = $${extraIdx++}`);
    extraValues.push(typeof body.daily_request_limit === "number" && body.daily_request_limit > 0 ? body.daily_request_limit : null);
  }
  if (body.monthly_request_limit !== undefined) {
    extraFields.push(`monthly_request_limit = $${extraIdx++}`);
    extraValues.push(typeof body.monthly_request_limit === "number" && body.monthly_request_limit > 0 ? body.monthly_request_limit : null);
  }
  if (body.monthly_budget_limit_usd !== undefined) {
    extraFields.push(`monthly_budget_limit_usd = $${extraIdx++}`);
    extraValues.push(typeof body.monthly_budget_limit_usd === "number" && body.monthly_budget_limit_usd > 0 ? body.monthly_budget_limit_usd : null);
  }
  if (body.monthly_budget_warning_usd !== undefined) {
    extraFields.push(`monthly_budget_warning_usd = $${extraIdx++}`);
    extraValues.push(typeof body.monthly_budget_warning_usd === "number" && body.monthly_budget_warning_usd > 0 ? body.monthly_budget_warning_usd : null);
  }
  if (body.daily_request_warning !== undefined) {
    extraFields.push(`daily_request_warning = $${extraIdx++}`);
    extraValues.push(typeof body.daily_request_warning === "number" && body.daily_request_warning > 0 ? body.daily_request_warning : null);
  }

  const hasExtraUpdates = extraFields.length > 0;

  if (!hasStandardUpdates && !hasExtraUpdates) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    if (hasStandardUpdates) {
      await updateAiKey(id, standardUpdates);
    }

    if (hasExtraUpdates) {
      extraFields.push(`updated_at = $${extraIdx++}`);
      extraValues.push(new Date().toISOString());
      extraValues.push(id);

      await execute(
        `UPDATE ai_api_keys SET ${extraFields.join(", ")} WHERE id = $${extraIdx}`,
        extraValues
      );
    }

    const key = await queryOne<any>(
      `SELECT
         ak.*,
         COALESCE(ue.today_calls, 0)::int as today_calls,
         COALESCE(ue.today_tokens, 0)::int as today_tokens,
         COALESCE(ue.today_cost, 0)::numeric as today_cost,
         COALESCE(ar.assignment_count, 0)::int as assignment_count
       FROM ai_api_keys ak
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*)::int as today_calls,
           COALESCE(SUM(input_tokens + COALESCE(output_tokens, 0)), 0)::int as today_tokens,
           COALESCE(SUM(estimated_cost_usd), 0)::numeric as today_cost
         FROM ai_usage_events
         WHERE created_at >= CURRENT_DATE
         GROUP BY ai_key_id
       ) ue ON ak.id = ue.ai_key_id
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*)::int as assignment_count
         FROM ai_automation_routes
         WHERE is_enabled = true
         GROUP BY ai_key_id
       ) ar ON ak.id = ar.ai_key_id
       WHERE ak.id = $1`,
      [id]
    );

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "update",
      description: `Updated AI API key: ${key?.label ?? id}`,
      entityType: "ai_api_key",
      entityId: id,
      entityName: key?.label ?? id,
      metadata: { provider: key?.provider },
    });

    return NextResponse.json({ key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Key ID is required" }, { status: 400 });
  }

  try {
    const key = await queryOne<any>(
      "SELECT * FROM ai_api_keys WHERE id = $1",
      [id]
    );

    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const assignments = await query<any>(
      `SELECT ar.*, a.label as automation_label, a.description as automation_description
       FROM ai_automation_routes ar
       LEFT JOIN ai_automations a ON ar.automation_id = a.id
       WHERE ar.ai_key_id = $1`,
      [id]
    );

    if (assignments.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete key with active route assignments. Remove the key from all automations first.",
          assignments,
        },
        { status: 409 }
      );
    }

    await execute("DELETE FROM ai_api_keys WHERE id = $1", [id]);

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "delete",
      description: `Deleted AI API key: ${key.label}`,
      entityType: "ai_api_key",
      entityId: key.id,
      entityName: key.label,
      metadata: { provider: key.provider },
    });

    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
