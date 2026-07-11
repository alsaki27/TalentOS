// AI Key Manager v2 routing service.
// Replaces the 1-row-per-category model with per-automation fallback chains.
// Tracks every real AI call (not just admin test clicks) in ai_usage_events.

import { AiProvider, AiMessage, AiTool } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/ai/pricing";
import { query, queryOne, execute } from "@/server/db/neon";
import { listEnabledAiKeys, getAiKeyWithDecryptedKey, type AiProvider as DbAiProvider, type AiKeyStatus } from "@/server/repositories/aiKeyRepository";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";
import { getProviderByName, getActiveProviderAsync } from "@/lib/ai/index";

export interface AutomationRouteResult {
  provider: AiProvider;
  name: string;
  aiKeyId: string | null;
  automationId: string;
  model?: string | null;
  routeRank: number | null;
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
  for (const route of routes) {
    if (route.ai_key_id) {
      if (excludeKeyIds?.has(route.ai_key_id)) continue;
      const keyRow = await getAiKeyWithDecryptedKey(route.ai_key_id);
      if (!keyRow || !keyRow.is_enabled) continue;
      const blockedStatuses: AiKeyStatus[] = ["disabled", "rate_limited", "quota_exhausted"];
      if (blockedStatuses.includes(keyRow.status)) continue;
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
}

export interface CallContext {
  userId?: string;
  workflowId?: string;
  applicationId?: string;
  attemptNumber?: number;
}

/**
 * Wrapper that resolves a provider via D-AI.2.1, calls fn, and records a usage event.
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
  const resolved = await getProviderForAutomation(automationId, excludeKeyIds);
  if (!resolved) {
    throw new Error(`No AI provider available for automation: ${automationId}`);
  }

  const start = Date.now();
  let outcome: "success" | "failure" | "timeout" = "success";
  let errorMessage: string | null = null;
  let errorCode: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  let capturedUsage: { input_tokens: number; output_tokens: number } | null = null;

  const wrappedProvider: AiProvider = {
    send: async (opts) => {
      const response = await resolved.provider.send(opts);
      if (response.usage) {
        capturedUsage = response.usage;
      }
      return response;
    },
  };

  try {
    const result = await fn(wrappedProvider);

    if (capturedUsage) {
      inputTokens = capturedUsage.input_tokens;
      outputTokens = capturedUsage.output_tokens;
    }

    const latencyMs = Date.now() - start;
    outcome = "success";

    await recordUsageEvent({
      automationId,
      aiKeyId: resolved.aiKeyId,
      provider: resolved.name,
      model: resolved.model ?? null,
      outcome,
      latencyMs,
      inputTokens,
      outputTokens,
      errorMessage,
      errorCode,
      userId: ctx?.userId ?? null,
      workflowId: ctx?.workflowId ?? null,
      applicationId: ctx?.applicationId ?? null,
      attemptNumber: ctx?.attemptNumber ?? null,
      routeRank: resolved.routeRank,
    });

    return { result, providerName: resolved.name, aiKeyId: resolved.aiKeyId, model: resolved.model ?? null, routeRank: resolved.routeRank };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    errorMessage = err.message ?? "Unknown error";
    outcome = latencyMs > 60000 ? "timeout" : "failure";
    errorCode = classifyErrorCode(err);

    if (capturedUsage) {
      inputTokens = capturedUsage.input_tokens;
      outputTokens = capturedUsage.output_tokens;
    }

    await recordUsageEvent({
      automationId,
      aiKeyId: resolved.aiKeyId,
      provider: resolved.name,
      model: resolved.model ?? null,
      outcome,
      latencyMs,
      inputTokens,
      outputTokens,
      errorMessage,
      errorCode,
      userId: ctx?.userId ?? null,
      workflowId: ctx?.workflowId ?? null,
      applicationId: ctx?.applicationId ?? null,
      attemptNumber: ctx?.attemptNumber ?? null,
      routeRank: resolved.routeRank,
    });

    throw err;
  }
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
