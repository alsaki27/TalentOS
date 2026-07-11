import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { query, execute } from "@/server/db/neon";
import {
  createAiKey,
  type AiProvider,
  type AiApiKeyRow,
} from "@/server/repositories/aiKeyRepository";
import { testAiKey } from "@/server/services/aiProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const keys = await query<any>(
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
       ORDER BY ak.priority ASC, ak.created_at ASC`
    );

    return NextResponse.json({ keys });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  if (!isEncryptionAvailable()) {
    return NextResponse.json(
      {
        error: "AI key encryption is not configured. Set AI_KEYS_ENCRYPTION_SECRET in your environment to add API keys.",
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider as AiProvider;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const priority = typeof body.priority === "number" ? body.priority : 100;
  const isEnabled = body.isEnabled !== false;
  const baseUrl = typeof body.base_url === "string" && body.base_url.trim() ? body.base_url.trim() : null;
  const notes = typeof body.notes === "string" ? body.notes : null;
  const dailyRequestLimit = typeof body.daily_request_limit === "number" && body.daily_request_limit > 0 ? body.daily_request_limit : null;
  const monthlyRequestLimit = typeof body.monthly_request_limit === "number" && body.monthly_request_limit > 0 ? body.monthly_request_limit : null;
  const monthlyBudgetLimitUsd = typeof body.monthly_budget_limit_usd === "number" && body.monthly_budget_limit_usd > 0 ? body.monthly_budget_limit_usd : null;
  const monthlyBudgetWarningUsd = typeof body.monthly_budget_warning_usd === "number" && body.monthly_budget_warning_usd > 0 ? body.monthly_budget_warning_usd : null;
  const dailyRequestWarning = typeof body.daily_request_warning === "number" && body.daily_request_warning > 0 ? body.daily_request_warning : null;

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  const validProviders: AiProvider[] = [
    "anthropic", "nvidia", "openai", "glm", "google", "google_vertex_proxy",
    "groq", "openrouter", "deepseek", "local", "opencode",
  ];
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: `Invalid provider: ${provider}` }, { status: 400 });
  }

  try {
    const key = await createAiKey({
      provider,
      label,
      apiKey,
      model,
      priority,
      isEnabled,
      createdBy: context?.profile.user_id,
    });

    if (
      baseUrl !== null ||
      notes !== null ||
      dailyRequestLimit !== null ||
      monthlyRequestLimit !== null ||
      monthlyBudgetLimitUsd !== null ||
      monthlyBudgetWarningUsd !== null ||
      dailyRequestWarning !== null
    ) {
      await execute(
        `UPDATE ai_api_keys
         SET base_url = COALESCE($1, base_url),
             notes = COALESCE($2, notes),
             daily_request_limit = COALESCE($3, daily_request_limit),
             monthly_request_limit = COALESCE($4, monthly_request_limit),
             monthly_budget_limit_usd = COALESCE($5, monthly_budget_limit_usd),
             monthly_budget_warning_usd = COALESCE($6, monthly_budget_warning_usd),
             daily_request_warning = COALESCE($7, daily_request_warning)
         WHERE id = $8`,
        [baseUrl, notes, dailyRequestLimit, monthlyRequestLimit, monthlyBudgetLimitUsd, monthlyBudgetWarningUsd, dailyRequestWarning, key.id]
      );
    }

    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || undefined,
      type: "create",
      description: `Added AI API key: ${label} (${provider})`,
      entityType: "ai_api_key",
      entityId: key.id,
      entityName: label,
      metadata: { provider, priority, fingerprint: key.key_fingerprint },
    });

    const refreshedKey = await query<any>(
      "SELECT * FROM ai_api_keys WHERE id = $1",
      [key.id]
    );

    const testResult = await testAiKey(key.id);

    return NextResponse.json({
      key: refreshedKey[0] ?? key,
      test: testResult,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
