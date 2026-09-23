import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeApiError } from "@/lib/utils";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { query, execute } from "@/server/db/neon";
import {
  createAiKey,
  type AiProvider,
  type AiApiKeyRow,
} from "@/server/repositories/aiKeyRepository";
import { testAiKey } from "@/server/services/aiProvider";
import { discoverModelsForKey } from "@/server/services/aiModelDiscoveryService";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  try {
    const keys = await query<any>(
       `SELECT
          ak.id, ak.provider, ak.label, ak.model, ak.base_url, ak.priority,
          ak.is_enabled, ak.status, ak.last_tested_at, ak.last_test_status,
          ak.last_test_latency_ms, ak.last_success_at, ak.last_failure_at,
          ak.last_error_code, ak.last_error_message, ak.usage_count, ak.failure_count,
          ak.daily_request_warning, ak.daily_request_limit, ak.monthly_request_limit,
          ak.monthly_budget_warning_usd, ak.monthly_budget_limit_usd, ak.notes,
          ak.created_by, ak.created_at, ak.updated_at, ak.provider_config,
          ak.chat_endpoint, ak.models_endpoint,
          ak.supports_tools, ak.supports_json_mode, ak.supports_streaming, ak.is_protected,
         COALESCE(ue.today_calls, 0)::int as today_calls,
         COALESCE(ue.today_tokens, 0)::int as today_tokens,
         COALESCE(ue.today_cost, 0)::numeric as today_cost,
         ue.success_rate,
         ue.avg_latency,
         COALESCE(ar.assignment_count, 0)::int as assignment_count,
         COALESCE(ar.fallback_count, 0)::int as fallback_count
       FROM ai_api_keys ak
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*)::int as today_calls,
           COALESCE(SUM(input_tokens + COALESCE(output_tokens, 0)), 0)::int as today_tokens,
           COALESCE(SUM(estimated_cost_usd), 0)::numeric as today_cost,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE outcome = 'success')
             / NULLIF(COUNT(*) FILTER (WHERE outcome <> 'skipped'), 0),
             1
           )::numeric as success_rate,
           ROUND(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL))::int as avg_latency
         FROM ai_usage_events
         WHERE created_at >= CURRENT_DATE
         GROUP BY ai_key_id
       ) ue ON ak.id = ue.ai_key_id
       LEFT JOIN (
         SELECT
           ai_key_id,
           COUNT(*) FILTER (WHERE rank = 1)::int as assignment_count,
           COUNT(*) FILTER (WHERE rank > 1)::int as fallback_count
         FROM ai_automation_routes
         WHERE is_enabled = true
         GROUP BY ai_key_id
       ) ar ON ak.id = ar.ai_key_id
       ORDER BY ak.priority ASC, ak.created_at ASC`
    );

    return NextResponse.json({ keys });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}

function isSsrfTarget(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "0.0.0.0") return true;
  const ipv4 = lower.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

function validateBaseUrl(url: string): string | null {
  const isProd = process.env.NODE_ENV === "production" || !!process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!isProd) return null;
  if (process.env.ALLOW_LOCAL_AI_ENDPOINTS === "true") return null;
  try {
    const hostname = new URL(url).hostname;
    if (isSsrfTarget(hostname)) return `base_url targets a private/internal host: ${hostname}`;
    return null;
  } catch {
    return "base_url is not a valid URL";
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

  const providerMode = typeof body.provider_mode === "string" && body.provider_mode.trim() ? body.provider_mode.trim() : undefined;
  const apiStyleValue = typeof body.api_style === "string" && body.api_style.trim() ? body.api_style.trim() : null;
  const modelsEndpoint = typeof body.models_endpoint === "string" && body.models_endpoint.trim() ? body.models_endpoint.trim() : null;
  const chatEndpoint = typeof body.chat_endpoint === "string" && body.chat_endpoint.trim() ? body.chat_endpoint.trim() : null;
  const authHeaderName = typeof body.auth_header_name === "string" && body.auth_header_name.trim() ? body.auth_header_name.trim() : null;
  const authScheme = typeof body.auth_scheme === "string" && body.auth_scheme.trim() ? body.auth_scheme.trim() : null;
  const customHeaders = body.custom_headers !== null && typeof body.custom_headers === "object" && !Array.isArray(body.custom_headers) ? body.custom_headers : null;
  const providerConfig = body.provider_config !== null && typeof body.provider_config === "object" && !Array.isArray(body.provider_config)
    ? body.provider_config as Record<string, unknown>
    : {};
  if (customHeaders) {
    const forbiddenHeaders = new Set(["authorization", "x-api-key", "x-goog-api-key", "host", "content-type"]);
    for (const key of Object.keys(customHeaders)) {
      const lower = key.toLowerCase();
      if (forbiddenHeaders.has(lower)) {
        return NextResponse.json({ error: `custom_headers cannot override "${key}"` }, { status: 400 });
      }
      if (lower.startsWith("cf-")) {
        delete customHeaders[key];
      }
    }
  }
  const availableModels = Array.isArray(body.available_models) ? body.available_models : undefined;
  const defaultModel = typeof body.default_model === "string" && body.default_model.trim() ? body.default_model.trim() : null;
  const supportsModelDiscovery = body.supports_model_discovery === true;
  const supportsTools = body.supports_tools !== undefined ? body.supports_tools === true : undefined;
  const supportsJsonMode = body.supports_json_mode !== undefined ? body.supports_json_mode === true : undefined;
  const supportsStreaming = body.supports_streaming !== undefined ? body.supports_streaming === true : undefined;
  const isProtected = body.is_protected === true;

  if (baseUrl) {
    const ssrfError = validateBaseUrl(baseUrl);
    if (ssrfError) return NextResponse.json({ error: ssrfError }, { status: 400 });
  }

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
    "groq", "openrouter", "deepseek", "local", "opencode", "moonshot", "openai_compatible",
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
      baseUrl,
      priority,
      isEnabled,
      createdBy: context?.profile.user_id,
      providerMode,
      apiStyle: apiStyleValue,
      modelsEndpoint,
      chatEndpoint,
      authHeaderName,
      authScheme,
      customHeaders,
      providerConfig,
      availableModels,
      defaultModel,
      supportsModelDiscovery,
      supportsTools,
      supportsJsonMode,
      supportsStreaming,
      isProtected,
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

    if (body.supports_model_discovery === true && baseUrl) {
      discoverModelsForKey(key.id).catch(() => {});
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

    const testResult = await testAiKey(key.id);

    let autoEnabled = false;
    if (testResult.success) {
      autoEnabled = true;
      if (!key.is_enabled) {
        await execute(
          `UPDATE ai_api_keys SET is_enabled = $1, updated_at = $2 WHERE id = $3`,
          [true, new Date().toISOString(), key.id]
        );
      }
    } else {
      const newStatus = testResult.error ? "invalid" : "unknown";
      await execute(
        `UPDATE ai_api_keys SET is_enabled = $1, status = $2, updated_at = $3 WHERE id = $4`,
        [false, newStatus, new Date().toISOString(), key.id]
      );
    }

    const refreshedKey = await query<any>(
      `SELECT id, provider, label, model, base_url, priority,
               is_enabled, status, last_tested_at, last_test_status,
               last_test_latency_ms, last_success_at, last_failure_at,
               last_error_code, last_error_message, usage_count, failure_count,
               daily_request_warning, daily_request_limit, monthly_request_limit,
               monthly_budget_warning_usd, monthly_budget_limit_usd, notes,
               created_by, created_at, updated_at
        FROM ai_api_keys WHERE id = $1`,
      [key.id]
    );

    return NextResponse.json({
      key: refreshedKey[0] ?? key,
      test: testResult,
      autoEnabled,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: sanitizeApiError(err) }, { status: 500 });
  }
}
