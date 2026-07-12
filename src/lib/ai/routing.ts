// AI Key Manager v2 routing service.
// Replaces the 1-row-per-category model with per-automation fallback chains.
// Tracks every real AI call (not just admin test clicks) in ai_usage_events.

import { AiProvider } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/ai/pricing";
import { query, queryOne, execute } from "@/server/db/neon";
import { listEnabledAiKeys, getAiKeyWithDecryptedKey, type AiKeyStatus } from "@/server/repositories/aiKeyRepository";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";
import { getProviderByName, getActiveProviderAsync } from "@/lib/ai/index";

export interface AutomationRouteResult {
  provider: AiProvider;
  name: string;
  aiKeyId: string | null;
  automationId: string;
  model?: string | null;
  routeRank: number | null;
  limitSkipped?: boolean;
}

interface AutomationRouteRow {
  id: string;
  automation_id: string;
  ai_key_id: string | null;
  provider: string | null;
  rank: number;
  is_enabled: boolean;
  model_override: string | null;
}

async function checkKeyLimits(keyRow: any): Promise<{ allowed: boolean; reason?: string }> {
  if (keyRow.daily_request_limit) {
    const todayCount = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int as cnt FROM ai_usage_events WHERE ai_key_id = $1 AND created_at::date = CURRENT_DATE`,
      [keyRow.id]
    );
    if (todayCount && todayCount.cnt >= keyRow.daily_request_limit) {
      return { allowed: false, reason: 'daily_request_limit_reached' };
    }
  }

  if (keyRow.monthly_request_limit) {
    const monthCount = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int as cnt FROM ai_usage_events WHERE ai_key_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [keyRow.id]
    );
    if (monthCount && monthCount.cnt >= keyRow.monthly_request_limit) {
      return { allowed: false, reason: 'monthly_request_limit_reached' };
    }
  }

  if (keyRow.monthly_budget_warning_usd) {
    const monthCost = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM ai_usage_events
       WHERE ai_key_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [keyRow.id]
    );
    if (monthCost && monthCost.total >= keyRow.monthly_budget_warning_usd) {
      console.warn(`[routing] Key ${keyRow.id} (${keyRow.provider}) monthly budget warning: $${monthCost.total.toFixed(4)} >= $${keyRow.monthly_budget_warning_usd}`);
    }
  }

  if (keyRow.monthly_budget_limit_usd) {
    const monthCost = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM ai_usage_events
       WHERE ai_key_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [keyRow.id]
    );
    if (monthCost && monthCost.total >= keyRow.monthly_budget_limit_usd) {
      return { allowed: false, reason: 'monthly_budget_exhausted' };
    }
  }

  return { allowed: true };
}

/**
 * Resolve a provider for the given automation by walking its ordered fallback chain.
 * Falls back to the global env-based chain if no routes are configured or all fail.
 */
export async function getProviderForAutomation(
  automationId: string,
  excludeKeyIds?: Set<string>,
): Promise<AutomationRouteResult | null> {
  // 1. Load ordered enabled routes for this automation
  const routes = await query<AutomationRouteRow>(
    `SELECT * FROM ai_automation_routes
     WHERE automation_id = $1 AND is_enabled = $2
     ORDER BY rank ASC`,
    [automationId, true]
  );

  // 2. Try each route in order, excluding failed keys
  let limitSkipped = false;
  for (const route of routes) {
    if (route.ai_key_id) {
      if (excludeKeyIds?.has(route.ai_key_id)) continue;
      const keyRow = await getAiKeyWithDecryptedKey(route.ai_key_id);
      if (!keyRow || !keyRow.is_enabled) continue;
      const blockedStatuses: AiKeyStatus[] = ["disabled", "rate_limited", "quota_exhausted"];
      if (blockedStatuses.includes(keyRow.status)) continue;

      const limitCheck = await checkKeyLimits(keyRow);
      if (!limitCheck.allowed) {
        limitSkipped = true;
        continue;
      }

      const effectiveModel = route.model_override ?? keyRow.model;
      const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, (keyRow as any).base_url);
      if (provider) {
        return {
          provider,
          name: keyRow.provider as AutomationRouteResult["name"],
          aiKeyId: keyRow.id,
          automationId,
          model: effectiveModel,
          routeRank: route.rank,
          limitSkipped,
        };
      }
    } else if (route.provider) {
      const envProvider = getProviderByName(route.provider);
      if (envProvider) {
        return {
          provider: envProvider.provider,
          name: route.provider as AutomationRouteResult["name"],
          aiKeyId: null,
          automationId,
          routeRank: route.rank,
          limitSkipped,
        };
      }
      // Try DB keys for this provider
      const dbKeys = await listEnabledAiKeys();
      for (const key of dbKeys) {
        if (excludeKeyIds?.has(key.id)) continue;
        if (key.provider !== route.provider) continue;
        const blockedStatuses: AiKeyStatus[] = ["disabled", "rate_limited", "quota_exhausted"];
        if (blockedStatuses.includes(key.status)) continue;
        const keyRow = await getAiKeyWithDecryptedKey(key.id);
        if (!keyRow) continue;

        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) {
          limitSkipped = true;
          continue;
        }

        const effectiveModel = route.model_override ?? keyRow.model;
        const dbProvider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, (keyRow as any).base_url);
        if (dbProvider) {
          return {
            provider: dbProvider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: effectiveModel,
            routeRank: route.rank,
            limitSkipped,
          };
        }
      }
    }
  }

  // 3. Fall back to global env-based chain
  const global = await getActiveProviderAsync();
  if (global) {
    return {
      provider: global.provider,
      name: global.name,
      aiKeyId: null,
      automationId,
      routeRank: null,
    };
  }

  return null;
}

/**
 * Result of a callWithUsageTracking invocation.
 * Exposes both the user's return value and the provider metadata so callers
 * can record which model/provider was used (e.g. jobCategorization's category_model).
 */
export interface CallWithUsageTrackingResult<T> {
  result: T;
  providerName: string;
  aiKeyId: string | null;
  model: string | null;
  routeRank: number | null;
  limitSkipped?: boolean;
}

export interface CallContext {
  userId?: string;
  workflowId?: string;
  applicationId?: string;
  attemptNumber?: number;
}

async function trySingleRoute<T>(
  route: AutomationRouteRow,
  automationId: string,
  ctx: CallContext | undefined,
  attemptNumber: number,
  excludeKeyIds: Set<string>,
  fn: (provider: AiProvider) => Promise<T>,
): Promise<{ success: true; result: T; resolved: AutomationRouteResult } | { success: false; error: any; resolved: AutomationRouteResult | null }> {
  let resolved: AutomationRouteResult | null = null;

  if (route.ai_key_id) {
    if (excludeKeyIds.has(route.ai_key_id)) return { success: false, error: new Error('Key excluded'), resolved: null };
    const keyRow = await getAiKeyWithDecryptedKey(route.ai_key_id);
    if (!keyRow || !keyRow.is_enabled) return { success: false, error: new Error('Key not found or disabled'), resolved: null };
    const blockedStatuses: AiKeyStatus[] = ["disabled", "rate_limited", "quota_exhausted"];
    if (blockedStatuses.includes(keyRow.status)) return { success: false, error: new Error('Key blocked by status'), resolved: null };

    const limitCheck = await checkKeyLimits(keyRow);
    if (!limitCheck.allowed) return { success: false, error: new Error(limitCheck.reason ?? 'limit_reached'), resolved: null };

    const effectiveModel = route.model_override ?? keyRow.model;
    const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, (keyRow as any).base_url);
    if (provider) {
      resolved = { provider, name: keyRow.provider, aiKeyId: keyRow.id, automationId, model: effectiveModel, routeRank: route.rank };
    }
  } else if (route.provider) {
    const envProvider = getProviderByName(route.provider);
    if (envProvider) {
      resolved = { provider: envProvider.provider, name: route.provider, aiKeyId: null, automationId, routeRank: route.rank };
    } else {
      const dbKeys = await listEnabledAiKeys();
      for (const key of dbKeys) {
        if (excludeKeyIds.has(key.id)) continue;
        if (key.provider !== route.provider) continue;
        const blockedStatuses: AiKeyStatus[] = ["disabled", "rate_limited", "quota_exhausted"];
        if (blockedStatuses.includes(key.status)) continue;
        const keyRow = await getAiKeyWithDecryptedKey(key.id);
        if (!keyRow) continue;
        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) continue;
        const effectiveModel = route.model_override ?? keyRow.model;
        const dbProvider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, (keyRow as any).base_url);
        if (dbProvider) {
          resolved = { provider: dbProvider, name: keyRow.provider, aiKeyId: keyRow.id, automationId, model: effectiveModel, routeRank: route.rank };
          break;
        }
      }
    }
  }

  if (!resolved) return { success: false, error: new Error('No eligible provider for route'), resolved: null };

  const start = Date.now();
  const usageRef: { current: { input_tokens: number; output_tokens: number } | null } = { current: null };

  const wrappedProvider: AiProvider = {
    send: async (opts) => {
      const response = await resolved.provider.send(opts);
      if (response.usage) {
        usageRef.current = response.usage;
      }
      return response;
    },
  };

  try {
    const result = await fn(wrappedProvider);

    const latencyMs = Date.now() - start;
    await recordUsageEvent({
      automationId,
      aiKeyId: resolved.aiKeyId,
      provider: resolved.name,
      model: resolved.model ?? null,
      outcome: "success",
      latencyMs,
      inputTokens: usageRef.current?.input_tokens ?? null,
      outputTokens: usageRef.current?.output_tokens ?? null,
      errorMessage: null,
      errorCode: null,
      userId: ctx?.userId ?? null,
      workflowId: ctx?.workflowId ?? null,
      applicationId: ctx?.applicationId ?? null,
      attemptNumber,
      routeRank: resolved.routeRank,
    });

    return { success: true, result, resolved };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const outcome: "failure" | "timeout" = latencyMs > 60000 ? "timeout" : "failure";

    await recordUsageEvent({
      automationId,
      aiKeyId: resolved.aiKeyId,
      provider: resolved.name,
      model: resolved.model ?? null,
      outcome,
      latencyMs,
      inputTokens: usageRef.current?.input_tokens ?? null,
      outputTokens: usageRef.current?.output_tokens ?? null,
      errorMessage: err.message ?? "Unknown error",
      errorCode: classifyErrorCode(err),
      userId: ctx?.userId ?? null,
      workflowId: ctx?.workflowId ?? null,
      applicationId: ctx?.applicationId ?? null,
      attemptNumber,
      routeRank: resolved.routeRank,
    });

    return { success: false, error: err, resolved };
  }
}

/**
 * Wrapper that resolves providers via the fallback chain, calls fn, and records usage events.
 * Records both successful and failed attempts so the usage log shows the full chain:
 * primary failed -> fallback 1 failed -> fallback 2 succeeded.
 * Handles both success and failure paths. Token/cost fields populated from provider
 * response usage when available.
 * Returns both the user's result and provider metadata.
 */
export async function callWithUsageTracking<T>(
  automationId: string,
  ctx: CallContext | undefined,
  fn: (provider: AiProvider) => Promise<T>,
  excludeKeyIds?: Set<string>,
): Promise<CallWithUsageTrackingResult<T>> {
  const routes = await query<AutomationRouteRow>(
    `SELECT * FROM ai_automation_routes
     WHERE automation_id = $1 AND is_enabled = $2
     ORDER BY rank ASC`,
    [automationId, true]
  );

  if (routes.length === 0) {
    const global = await getActiveProviderAsync();
    if (global) {
      const start = Date.now();
      const usageRef: { current: { input_tokens: number; output_tokens: number } | null } = { current: null };
      const wrappedProvider: AiProvider = {
        send: async (opts) => {
          const response = await global.provider.send(opts);
          if (response.usage) usageRef.current = response.usage;
          return response;
        },
      };
      try {
        const result = await fn(wrappedProvider);
        await recordUsageEvent({
          automationId, aiKeyId: null, provider: global.name, model: null,
          outcome: "success", latencyMs: Date.now() - start,
          inputTokens: usageRef.current?.input_tokens ?? null,
          outputTokens: usageRef.current?.output_tokens ?? null,
          errorMessage: null, errorCode: null,
          userId: ctx?.userId ?? null, workflowId: ctx?.workflowId ?? null,
          applicationId: ctx?.applicationId ?? null, attemptNumber: ctx?.attemptNumber ?? null, routeRank: null,
        });
        return { result, providerName: global.name, aiKeyId: null, model: null, routeRank: null };
      } catch (err: any) {
        const latencyMs = Date.now() - start;
        await recordUsageEvent({
          automationId, aiKeyId: null, provider: global.name, model: null,
          outcome: latencyMs > 60000 ? "timeout" : "failure", latencyMs,
          inputTokens: usageRef.current?.input_tokens ?? null,
          outputTokens: usageRef.current?.output_tokens ?? null,
          errorMessage: err.message ?? "Unknown error", errorCode: classifyErrorCode(err),
          userId: ctx?.userId ?? null, workflowId: ctx?.workflowId ?? null,
          applicationId: ctx?.applicationId ?? null, attemptNumber: ctx?.attemptNumber ?? null, routeRank: null,
        });
        throw err;
      }
    }
    throw new Error(`No AI provider available for automation: ${automationId}`);
  }

  const excluded = new Set(excludeKeyIds ?? []);
  let lastError: any = new Error(`No AI provider available for automation: ${automationId}`);

  for (let i = 0; i < routes.length; i++) {
    const attempt = await trySingleRoute(routes[i], automationId, ctx, i + 1, excluded, fn);
    if (attempt.success) {
      return {
        result: attempt.result,
        providerName: attempt.resolved.name,
        aiKeyId: attempt.resolved.aiKeyId,
        model: attempt.resolved.model ?? null,
        routeRank: attempt.resolved.routeRank,
        limitSkipped: attempt.resolved.limitSkipped,
      };
    }
    if (attempt.resolved?.aiKeyId) {
      excluded.add(attempt.resolved.aiKeyId);
    }
    lastError = attempt.error;
  }

  throw lastError;
}

function classifyErrorCode(err: any): string | null {
  const msg: string = (err?.message ?? "").toLowerCase();
  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("invalid api key") || msg.includes("auth")) return "auth_error";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) return "rate_limit";
  if (msg.includes("timeout") || msg.includes("408") || msg.includes("timed out")) return "timeout";
  if (msg.includes("not found") || msg.includes("404")) return "not_found";
  if (msg.includes("server error") || msg.includes("500") || msg.includes("502") || msg.includes("503")) return "server_error";
  return null;
}

interface UsageEventInput {
  automationId: string;
  aiKeyId: string | null;
  provider: string;
  model: string | null;
  outcome: "success" | "failure" | "timeout";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  userId: string | null;
  workflowId: string | null;
  applicationId: string | null;
  attemptNumber: number | null;
  routeRank: number | null;
}

async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  const cost = estimateCost(input.provider, input.model, input.inputTokens, input.outputTokens);

  await execute(
    `INSERT INTO ai_usage_events
      (automation_id, ai_key_id, provider, model, outcome,
       latency_ms, input_tokens, output_tokens, estimated_cost_usd,
       error_message, error_code, triggered_by_user_id,
       route_rank, attempt_number, workflow_id, application_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      input.automationId,
      input.aiKeyId,
      input.provider,
      input.model,
      input.outcome,
      input.latencyMs,
      input.inputTokens,
      input.outputTokens,
      cost,
      input.errorMessage,
      input.errorCode,
      input.userId,
      input.routeRank,
      input.attemptNumber,
      input.workflowId,
      input.applicationId,
    ]
  );
}
