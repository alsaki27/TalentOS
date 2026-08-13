// AI Key Manager v2 routing service.
// Replaces the 1-row-per-category model with per-automation fallback chains.
// Tracks every real AI call (not just admin test clicks) in ai_usage_events.

import { AiProvider, AiMessage, AiTool } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/ai/pricing";
import { query, queryOne, execute } from "@/server/db/neon";
import { listEnabledAiKeys, getAiKeyWithDecryptedKey, recordAiKeyFailure, recordAiKeySuccess, type AiProvider as DbAiProvider, type AiKeyStatus } from "@/server/repositories/aiKeyRepository";
import { buildProviderFromDbKey, getActiveProviderWithFallback } from "@/server/services/aiProvider";
import { createMockProvider } from "@/lib/ai/mockProvider";
import { getAiRuntimeConfig } from "@/server/repositories/aiRuntimeConfigRepository";

export interface AutomationRouteResult {
  provider: AiProvider;
  name: string;
  aiKeyId: string | null;
  automationId: string;
  model?: string | null;
  routeRank: number | null;
  /** Stable route id, used to retry a different model on the same provider key. */
  routeId?: string | null;
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

// These providers are intentionally pooled by provider rather than treated as
// a single credential. A route may name one key as its anchor, but a failed or
// cooling key should give its siblings a chance before the route advances to
// the next provider/model fallback.
const ROUND_ROBIN_POOL_PROVIDERS = new Set<string>([
  "opencode",
  "google_vertex_proxy",
]);

function isKeyHealthBlocked(keyRow: { status: AiKeyStatus; last_failure_at?: string | null }): boolean {
  if (["disabled", "invalid", "invalid_credential", "admin_limit_reached"].includes(keyRow.status)) return true;
  if (keyRow.status !== "rate_limited" && keyRow.status !== "quota_exhausted") return false;
  const failedAt = keyRow.last_failure_at ? Date.parse(keyRow.last_failure_at) : Number.NaN;
  // Provider-side throttles are not permanent circuit breakers. Retry after a
  // cooling window; database request/budget limits remain independently enforced.
  return Number.isFinite(failedAt) && Date.now() - failedAt < 15 * 60_000;
}

async function checkKeyLimits(keyRow: any): Promise<{ allowed: boolean; reason?: string }> {
  if (keyRow.daily_request_limit) {
    const todayCalls = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM ai_usage_events
       WHERE ai_key_id = $1 AND created_at >= CURRENT_DATE`,
      [keyRow.id]
    );
    if (todayCalls && todayCalls.count >= keyRow.daily_request_limit) {
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

  if (keyRow.monthly_budget_limit_usd) {
    const monthCost = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM ai_usage_events
       WHERE ai_key_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [keyRow.id]
    );
    // Both estimated_cost_usd and monthly_budget_limit_usd are Postgres
    // `numeric` columns - the driver returns them as strings ("2.01530",
    // "19.99000"), not JS numbers, to avoid float precision loss. Comparing
    // with >= directly does a LEXICOGRAPHIC string comparison, not a
    // numeric one: "2.01530" >= "19.99000" is true (since '2' > '1' as the
    // first character), so a key at ~10% of its real budget was being
    // treated as exhausted. Confirmed live: $2.02 of a $19.99 cap tripped
    // monthly_budget_exhausted on every call, silently skipping every AI
    // stage rather than making the request.
    const spent = Number(monthCost?.total ?? 0);
    const limit = Number(keyRow.monthly_budget_limit_usd);
    if (Number.isFinite(spent) && Number.isFinite(limit) && spent >= limit) {
      return { allowed: false, reason: 'monthly_budget_exhausted' };
    }
  }

  return { allowed: true };
}

type PoolCursorRow = { start_index: number | string | null };

/**
 * Advance a provider pool cursor atomically. If the additive cursor migration
 * has not reached a worker yet, fail open to index zero so a routing deploy
 * never takes down all AI calls; the next successful migration run restores
 * round-robin behavior.
 */
async function nextPoolIndex(provider: string, size: number): Promise<number> {
  if (size <= 1 || !ROUND_ROBIN_POOL_PROVIDERS.has(provider)) return 0;
  try {
    const row = await queryOne<PoolCursorRow>(
      `INSERT INTO ai_key_pool_cursors (pool_key, next_index, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT (pool_key) DO UPDATE
         SET next_index = ai_key_pool_cursors.next_index + 1,
             updated_at = now()
       RETURNING next_index - 1 AS start_index`,
      [provider]
    );
    const value = Number(row?.start_index ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) % size : 0;
  } catch (error) {
    console.warn(`[routing] round-robin cursor unavailable for ${provider}; using priority order`, error);
    return 0;
  }
}

/**
 * Return enabled sibling keys in a rotating order. The route's model override
 * is applied later, so all keys in a provider pool use the same model tier.
 */
async function getPoolKeyMetadata(
  provider: string,
  excludeKeyIds?: Set<string>,
): Promise<any[]> {
  const keys = (await listEnabledAiKeys())
    .filter((key) => key.provider === provider && !excludeKeyIds?.has(key.id))
    .filter((key) => !isKeyHealthBlocked(key as any))
    .sort((a, b) => {
      const priority = (a.priority ?? 100) - (b.priority ?? 100);
      if (priority !== 0) return priority;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id);
    });

  if (keys.length <= 1 || !ROUND_ROBIN_POOL_PROVIDERS.has(provider)) return keys;
  const start = await nextPoolIndex(provider, keys.length);
  return keys.slice(start).concat(keys.slice(0, start));
}

/**
 * Resolve a provider for the given automation by walking its ordered fallback chain.
 * Optionally falls back to the Neon global key pool if runtime policy allows it.
 */
export async function getProviderForAutomation(
  automationId: string,
  excludeKeyIds?: Set<string>,
  excludeProviderNames?: Set<string>,
  excludeRouteIds?: Set<string>,
): Promise<AutomationRouteResult | null> {
  // 0. Mock provider takes priority when explicitly configured
  if (process.env.AI_PROVIDER === "mock") {
    return {
      provider: createMockProvider(),
      name: "mock",
      aiKeyId: null,
      automationId,
      routeRank: 0,
      routeId: null,
    };
  }

  const runtime = await getAiRuntimeConfig();
  let routes = runtime.active_routing_state_id
    ? await query<AutomationRouteRow>(
        `SELECT (state_id::text || ':' || automation_id || ':' || rank::text) AS id,
                automation_id, ai_key_id, provider, rank, is_enabled, model_override
         FROM ai_routing_state_routes
         WHERE state_id = $1 AND automation_id = $2 AND is_enabled = true
         ORDER BY rank ASC`,
        [runtime.active_routing_state_id, automationId]
      )
    : [];
  if (routes.length === 0) {
    routes = await query<AutomationRouteRow>(
      `SELECT * FROM ai_automation_routes
       WHERE automation_id = $1 AND is_enabled = true
       ORDER BY rank ASC`,
      [automationId]
    );
  }

  // 2. Try each route in order, excluding failed keys
  let limitSkipped = false;
  for (const route of routes) {
    if (excludeRouteIds?.has(route.id)) continue;
    if (route.ai_key_id) {
      // An explicit key is the route's anchor. For pooled providers, sibling
      // keys are alternatives at this same route rank; for every other
      // provider the historical exact-key behavior is preserved.
      const anchorMetadata = (await listEnabledAiKeys()).find((key) => key.id === route.ai_key_id);
      const anchor = await getAiKeyWithDecryptedKey(route.ai_key_id);
      const anchorProvider = anchor?.provider ?? anchorMetadata?.provider;
      if (!anchorProvider) continue;
      if (excludeProviderNames?.has(anchorProvider)) continue;
      const candidates = ROUND_ROBIN_POOL_PROVIDERS.has(anchorProvider)
        ? await getPoolKeyMetadata(anchorProvider, excludeKeyIds)
        : (anchor && !excludeKeyIds?.has(route.ai_key_id) ? [anchor] : []);

      for (const candidate of candidates) {
        const keyRow = candidate.id === anchor?.id
          ? anchor
          : await getAiKeyWithDecryptedKey(candidate.id);
        if (!keyRow || !keyRow.is_enabled || isKeyHealthBlocked(keyRow)) continue;

        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) {
          limitSkipped = true;
          await recordUsageEvent({
            automationId,
            aiKeyId: keyRow.id,
            provider: keyRow.provider,
            model: route.model_override ?? keyRow.model ?? null,
            outcome: "skipped",
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            errorMessage: null,
            errorCode: limitCheck.reason ?? null,
            userId: null,
            workflowId: null,
            applicationId: null,
            attemptNumber: null,
            routeRank: route.rank,
          });
          continue;
        }

        const effectiveModel = route.model_override ?? keyRow.model;
        const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
        if (provider) {
          return {
            provider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: effectiveModel,
            routeRank: route.rank,
            routeId: route.id,
            limitSkipped,
          };
        }
      }
    } else if (route.provider) {
      // Skip this named provider if it already returned a rate-limit error.
      if (excludeProviderNames?.has(route.provider)) continue;
      // Provider-only routes resolve from Neon and never from deployment env.
      const dbKeys = await getPoolKeyMetadata(route.provider, excludeKeyIds);
      for (const key of dbKeys) {
        if (isKeyHealthBlocked(key as any)) continue;
        const keyRow = await getAiKeyWithDecryptedKey(key.id);
        if (!keyRow) continue;

        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) {
          limitSkipped = true;
          await recordUsageEvent({
            automationId,
            aiKeyId: keyRow.id,
            provider: keyRow.provider,
            model: route.model_override ?? keyRow.model ?? null,
            outcome: "skipped",
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            errorMessage: null,
            errorCode: limitCheck.reason ?? null,
            userId: null,
            workflowId: null,
            applicationId: null,
            attemptNumber: null,
            routeRank: route.rank,
          });
          continue;
        }

        const effectiveModel = route.model_override ?? keyRow.model;
        const dbProvider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
        if (dbProvider) {
          return {
            provider: dbProvider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: effectiveModel,
            routeRank: route.rank,
            routeId: route.id,
            limitSkipped,
          };
        }
      }
    }
  }

  // 3. Optional Neon-managed emergency fallback.
  if (!runtime.allow_unrouted_fallback) {
    throw new Error("All configured routes failed and global fallback is disabled. Configure a route for this automation in /admin/ai → Agents & Routing.");
  }

  // Emergency fallback is still Neon-managed. There is deliberately no
  // environment-provider loop here: provider keys outside the Control Center
  // would make production routing impossible to inspect or reproduce.
  // Last resort: the remaining enabled Neon key pool.
  const dbFallback = await getActiveProviderWithFallback();
  if (dbFallback && !excludeProviderNames?.has(dbFallback.name)) {
    await recordUsageEvent({
      automationId,
      aiKeyId: null,
      provider: dbFallback.name,
      model: null,
      outcome: "success",
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      errorMessage: null,
      errorCode: "global_emergency_fallback",
      userId: null,
      workflowId: null,
      applicationId: null,
      attemptNumber: null,
      routeRank: null,
    });
    return {
      provider: dbFallback.provider,
      name: dbFallback.name,
      aiKeyId: null,
      automationId,
      routeRank: null,
      routeId: null,
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

export class AiRouteCallError extends Error {
  aiKeyId: string | null;
  provider: string;
  model: string | null;
  routeRank: number | null;
  errorCode: string | null;

  constructor(message: string, details: {
    aiKeyId: string | null;
    provider: string;
    model: string | null;
    routeRank: number | null;
    errorCode: string | null;
  }) {
    super(message);
    this.name = 'AiRouteCallError';
    this.aiKeyId = details.aiKeyId;
    this.provider = details.provider;
    this.model = details.model;
    this.routeRank = details.routeRank;
    this.errorCode = details.errorCode;
  }
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
 *
 * On rate-limit / quota errors, the function automatically retries with the next
 * available provider in the fallback chain, skipping the one that returned the error.
 * It retries up to MAX_RETRIES times before giving up.
 *
 * Returns both the user's result and provider metadata.
 */
export async function callWithUsageTracking<T>(
  automationId: string,
  ctx: CallContext | undefined,
  fn: (provider: AiProvider) => Promise<T>,
  excludeKeyIds?: Set<string>,
): Promise<CallWithUsageTrackingResult<T>> {

  const MAX_RETRIES = 3;
  const excludedKeyIds = new Set<string>(excludeKeyIds ?? []);
  const excludedProviders = new Set<string>();
  const excludedRouteIds = new Set<string>();

  let lastError: Error | null = null;
  let lastResolved: AutomationRouteResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let resolved: AutomationRouteResult | null;
    try {
      resolved = await getProviderForAutomation(
        automationId,
        excludedKeyIds,
        attempt > 0 ? excludedProviders : undefined,
        excludedRouteIds,
      );
    } catch (routeError) {
      // Preserve provider/route metadata when the next fallback cannot resolve.
      // Raw SDK errors here made failed workflow stages lose their key, model,
      // route rank, and normalized error code in the Control Center.
      if (lastError) {
        if (lastError instanceof AiRouteCallError) throw lastError;
        throw new AiRouteCallError(
          lastError.message || "No AI provider available",
          {
            aiKeyId: lastResolved?.aiKeyId ?? null,
            provider: lastResolved?.name ?? "unknown",
            model: lastResolved?.model ?? null,
            routeRank: lastResolved?.routeRank ?? null,
            errorCode: classifyErrorCode(lastError),
          }
        );
      }
      throw routeError;
    }

    if (!resolved) {
      if (lastError) {
        if (lastError instanceof AiRouteCallError) throw lastError;
        throw new AiRouteCallError(
          lastError.message || "No AI provider available",
          {
            aiKeyId: lastResolved?.aiKeyId ?? null,
            provider: lastResolved?.name ?? "unknown",
            model: lastResolved?.model ?? null,
            routeRank: lastResolved?.routeRank ?? null,
            errorCode: classifyErrorCode(lastError),
          }
        );
      }
      throw new Error(`No AI provider available for automation: ${automationId}`);
    }

    lastResolved = resolved;
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
        const u: { input_tokens: number; output_tokens: number } = capturedUsage;
        inputTokens = u.input_tokens;
        outputTokens = u.output_tokens;
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
      if (resolved.aiKeyId) await recordAiKeySuccess(resolved.aiKeyId).catch(() => {});

      return {
        result,
        providerName: resolved.name,
        aiKeyId: resolved.aiKeyId,
        model: resolved.model ?? null,
        routeRank: resolved.routeRank,
        limitSkipped: resolved.limitSkipped,
      };
    } catch (err: any) {
      lastError = err;
      const latencyMs = Date.now() - start;
      errorMessage = err.message ?? "Unknown error";
      outcome = latencyMs > 60000 ? "timeout" : "failure";
      errorCode = classifyErrorCode(err);

      if (capturedUsage) {
        const u: { input_tokens: number; output_tokens: number } = capturedUsage;
        inputTokens = u.input_tokens;
        outputTokens = u.output_tokens;
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
      if (resolved.aiKeyId) await recordAiKeyFailure(resolved.aiKeyId, errorMessage ?? "Unknown provider error").catch(() => {});

      // On rate-limit / quota errors, exclude this provider and retry.
      const isRetriable = ["rate_limit", "auth_error", "timeout", "server_error", "not_found", "configuration_error"].includes(errorCode ?? "");

      if (isRetriable && attempt < MAX_RETRIES) {
        if (errorCode === "auth_error") {
          if (resolved.aiKeyId) excludedKeyIds.add(resolved.aiKeyId);
          else if (resolved.name) excludedProviders.add(resolved.name);
        } else if (resolved.aiKeyId) {
          // Keep the route rank alive and rotate to a sibling key for pooled
          // providers. The next route rank is reached only after the entire
          // same-provider pool has been exhausted or cooled down.
          excludedKeyIds.add(resolved.aiKeyId);
        } else if (resolved.routeId) {
          // Exclude the exact failed route, not the whole key/provider. This
          // lets a model-level fallback reuse the same gateway credential.
          excludedRouteIds.add(resolved.routeId);
        } else if (resolved.name) {
          excludedProviders.add(resolved.name);
        }
        console.warn(
          `[routing] ${automationId}: ${resolved.name}/${resolved.model ?? "default"} ` +
            `failed with ${errorCode}, retrying (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        continue;
      }

      break; // non-retriable or out of retries
    }
  }

  // Shouldn't get here, but just in case:
  if (lastError instanceof AiRouteCallError) throw lastError;
  throw new AiRouteCallError(lastError?.message || "Provider call failed", {
    aiKeyId: lastResolved?.aiKeyId ?? null,
    provider: lastResolved?.name ?? "unknown",
    model: lastResolved?.model ?? null,
    routeRank: lastResolved?.routeRank ?? null,
    errorCode: lastError ? classifyErrorCode(lastError) : null,
  });
}

function classifyErrorCode(err: any): string | null {
  const msg: string = (err?.message ?? "").toLowerCase();
  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("invalid api key") || msg.includes("auth")) return "auth_error";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) return "rate_limit";
  if (msg.includes("timeout") || msg.includes("408") || msg.includes("timed out")) return "timeout";
  if (msg.includes("not found") || msg.includes("404")) return "not_found";
  if ((msg.includes("model") && msg.includes("not available")) || msg.includes("permission_error") || msg.includes("400") || msg.includes("403")) return "configuration_error";
  if (msg.includes("server error") || msg.includes("500") || msg.includes("502") || msg.includes("503")) return "server_error";
  return null;
}

interface UsageEventInput {
  automationId: string;
  aiKeyId: string | null;
  provider: string;
  model: string | null;
  outcome: "success" | "failure" | "timeout" | "skipped";
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

  // This is analytics/usage tracking, not business-critical data - it must
  // never be allowed to break the actual AI call flow it's just observing.
  // Confirmed live: outcome: "skipped" violated ai_usage_events'
  // outcome CHECK constraint (fixed in sql/neon_fixes/022, which now
  // allows it), and because this insert wasn't guarded, that DB error
  // propagated all the way out of getProviderForAutomation - surfacing as
  // "All configured routes failed and global fallback is disabled" even
  // when a working route existed later in the chain. A future schema drift
  // of the same kind should degrade to a missing usage record, not a
  // broken pipeline.
  try {
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
  } catch (err) {
    console.error("[recordUsageEvent] Failed to record usage event (non-fatal):", err);
  }
}
