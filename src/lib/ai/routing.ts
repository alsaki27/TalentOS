
// AI Key Manager v2 routing service.
// Replaces the 1-row-per-category model with per-automation fallback chains.
// Tracks every real AI call (not just admin test clicks) in ai_usage_events.

import { AiProvider, AiMessage, AiTool } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/ai/pricing";
import { query, queryOne, execute } from "@/server/db/neon";
import { listEnabledAiKeys, getAiKeyWithDecryptedKey, recordAiKeyFailure, recordAiKeySuccess, isKeyCoolingDown, type AiProvider as DbAiProvider, type AiKeyStatus } from "@/server/repositories/aiKeyRepository";
import { buildProviderFromDbKey, getActiveProviderWithFallback } from "@/server/services/aiProvider";
import { createMockProvider } from "@/lib/ai/mockProvider";
import { getAiRuntimeConfig } from "@/server/repositories/aiRuntimeConfigRepository";

export interface AutomationRouteResult {
  provider: AiProvider;
  name: string;
  aiKeyId: string | null;
  automationId: string;
  model?: string | null;
  reasoningEffort?: string | null;
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
  reasoning_effort?: string | null;
}

// These providers are intentionally pooled by provider rather than treated as
// a single credential. A route may name one key as its anchor, but a failed or
// cooling key should give its siblings a chance before the route advances to
// the next provider/model fallback.
const ROUND_ROBIN_POOL_PROVIDERS = new Set<string>([
  "opencode",
  "google_vertex_proxy",
]);

// Temporary production mitigation (2026-10-04): honor the selected key on
// rank 1 in the active routing state for these three pipeline agents while the
// OpenCode sibling accounts are being repaired. Legacy routes, other agents,
// and every fallback rank keep normal pool rotation. Remove this override once
// the pool is healthy and key pinning is managed explicitly in the routing state.
const PINNED_OPENCODE_PRIMARY_AUTOMATIONS = new Set([
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
]);

/** Identity of one model served through one key, for per-model exclusion. */
function keyModelId(keyId: string, model: string | null | undefined): string {
  return `${keyId}|${model ?? ""}`;
}

// A provider credential can serve several model overrides.  Key-level health
// alone is therefore too coarse: one unavailable OpenCode model must not
// suppress a healthy Luna route on the same credential.  Keep this breaker
// scoped to provider + model + automation and let the route recover
// automatically after a short cooldown.
const ROUTE_HEALTH_WINDOW_MINUTES = 15;

// These signals belong to individual credentials (or a key/model entitlement),
// not the shared OpenCode model route. Counting them in the pool-wide breaker
// can block healthy sibling accounts precisely when round-robin recovery is
// needed; their in-call exclusions and per-key cooldown already handle them.
const PER_ACCOUNT_FAILURE_CODES = ["rate_limit", "billing_error", "auth_error", "model_unavailable"];

type RouteHealthRow = {
  recent_failures: number | string | null;
  recent_not_found: number | string | null;
  recent_timeouts: number | string | null;
  recent_invalid_outputs: number | string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
};

async function checkRouteHealth(
  automationId: string,
  provider: string,
  model: string | null | undefined,
  routeRank?: number,
): Promise<{ blocked: boolean; reason?: string }> {
  // This is intentionally limited to OpenCode. Vertex is the configured
  // safety net and must remain available even when it has a transient error;
  // blocking the only fallback would turn a recoverable provider incident
  // into a hard pipeline failure.
  if (provider !== "opencode" || !model) return { blocked: false };
  // The application pipeline's third route is an explicit last-resort
  // provider. Do not let the normal OpenCode circuit breaker make that route
  // unreachable after the two Vertex gateways have already failed; the
  // provider call itself remains the source of truth and can still fall
  // through to a retryable workflow error.
  if (automationId.startsWith("application_") && (routeRank ?? 0) >= 3) {
    return { blocked: false };
  }

  try {
    const health = await queryOne<RouteHealthRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE outcome IN ('failure', 'timeout')
             AND (error_code IS NULL OR NOT (error_code = ANY($5::text[])))
         )::int AS recent_failures,
         COUNT(*) FILTER (WHERE error_code = 'not_found')::int AS recent_not_found,
         COUNT(*) FILTER (WHERE error_code = 'timeout')::int AS recent_timeouts,
         COUNT(*) FILTER (WHERE error_code = 'invalid_output')::int AS recent_invalid_outputs,
         MAX(created_at) FILTER (WHERE outcome = 'success') AS last_success_at,
         MAX(created_at) FILTER (WHERE outcome IN ('failure', 'timeout')) AS last_failure_at
       FROM ai_usage_events
       WHERE automation_id = $1
         AND provider = $2
         AND model = $3
         AND created_at >= NOW() - make_interval(mins => $4)`,
      [automationId, provider, model, ROUTE_HEALTH_WINDOW_MINUTES, PER_ACCOUNT_FAILURE_CODES]
    );
    if (!health) return { blocked: false };

    const lastFailure = health.last_failure_at ? Date.parse(health.last_failure_at) : Number.NaN;
    const lastSuccess = health.last_success_at ? Date.parse(health.last_success_at) : Number.NaN;
    // A later success re-opens the route immediately; transient failures must
    // not keep a recovered model in cooldown.
    if (!Number.isFinite(lastFailure) || (Number.isFinite(lastSuccess) && lastSuccess >= lastFailure)) {
      return { blocked: false };
    }

    const notFound = Number(health.recent_not_found ?? 0);
    const timeouts = Number(health.recent_timeouts ?? 0);
    const invalidOutputs = Number(health.recent_invalid_outputs ?? 0);
    const failures = Number(health.recent_failures ?? 0);

    if (notFound >= 2) return { blocked: true, reason: "route_not_found_cooldown" };
    if (timeouts >= 2) return { blocked: true, reason: "route_timeout_cooldown" };
    if (invalidOutputs >= 3) return { blocked: true, reason: "route_output_cooldown" };
    if (failures >= 3) return { blocked: true, reason: "route_failure_cooldown" };
  } catch (error) {
    // Health telemetry is advisory. A schema/index issue must never disable
    // all AI routing; the normal provider fallback remains authoritative.
    console.warn(`[routing] route health check unavailable for ${provider}/${model}; continuing`, error);
  }

  return { blocked: false };
}

// Opt-in only for the scheduled batch executor. A malformed response or a
// slow request on one account must not black out every account for this
// automation. Other agents retain their existing model-wide breaker policy.
async function checkScheduledKeyModelHealth(automationId: string, keyId: string, model: string | null | undefined) {
  const latest = await queryOne<{ outcome: string; error_code: string | null; created_at: string }>(
    `SELECT outcome,error_code,created_at FROM ai_usage_events
      WHERE automation_id=$1 AND ai_key_id=$2 AND provider='opencode'
        AND (model=$3 OR error_code IN ('auth_error','billing_error'))
        AND outcome IN ('success','failure','timeout')
        AND created_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY created_at DESC,id DESC LIMIT 1`, [automationId,keyId,model ?? null],
  );
  if (!latest || latest.outcome === "success") return { blocked:false };
  const code=latest.error_code;
  const cooldownMs=code === "auth_error" || code === "billing_error" || code === "rate_limit" ? 15*60_000
    : code === "not_found" || code === "configuration_error" || code === "model_unavailable" ? 5*60_000
    : code === "invalid_output" || code === "timeout" ? 60_000 : 30_000;
  return { blocked:Date.now()-Date.parse(latest.created_at)<cooldownMs,
    reason:code === "auth_error" ? "key_auth_cooldown" : "key_model_cooldown" };
}

function isKeyHealthBlocked(
  keyRow: { provider?: string | null; status: AiKeyStatus; last_failure_at?: string | null; cooldown_until?: string | null },
  scheduledRecovery = false,
): boolean {
  if (["disabled", "invalid", "invalid_credential", "admin_limit_reached"].includes(keyRow.status)) return true;
  // An ordinary burst 429 need not block another model on this account.
  // Explicit Go weekly/monthly cooldowns and billing limits remain key-wide.
  if (scheduledRecovery && keyRow.provider === "opencode" && keyRow.status === "rate_limited" && !keyRow.cooldown_until) return false;
  return isKeyCoolingDown(keyRow);
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
  benchmarkMode?: boolean,
  scheduledRecovery = false,
): Promise<any[]> {
  const keys = (await listEnabledAiKeys())
    .filter((key) => key.provider === provider && !excludeKeyIds?.has(key.id))
    .filter((key) => !isKeyHealthBlocked(key as any, scheduledRecovery))
    .sort((a, b) => {
      const priority = (a.priority ?? 100) - (b.priority ?? 100);
      if (priority !== 0) return priority;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id);
    });

  if (keys.length <= 1 || !ROUND_ROBIN_POOL_PROVIDERS.has(provider)) return keys;
  // Benchmark/replay must never advance the live round-robin cursor - return
  // the stable priority order instead of rotating.
  if (benchmarkMode) return keys;
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
  routingStateId?: string | null,
  // key+model pairs that already failed in this call (see keyModelId). Lets a
  // later route reuse the same key with a DIFFERENT model - provider quotas
  // are per model, so one exhausted model must not hide the others.
  excludeKeyModels?: Set<string>,
  // See CallContext.benchmarkMode - suppresses every write this resolution
  // would otherwise make (skipped/fallback usage events, pool cursor advance).
  benchmarkMode?: boolean,
  scheduledPoolRecovery?: boolean,
): Promise<AutomationRouteResult | null> {
  const keyScopedRecovery = scheduledPoolRecovery === true && automationId === "scheduled_candidate_logging_eligibility_check";
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
  const selectedRoutingStateId = routingStateId ?? runtime.active_routing_state_id;
  let usingRoutingStateRoutes = Boolean(selectedRoutingStateId);
  let routes = selectedRoutingStateId
    ? await query<AutomationRouteRow>(
        `SELECT (state_id::text || ':' || automation_id || ':' || rank::text) AS id,
                automation_id, ai_key_id, provider, rank, is_enabled, model_override,
                reasoning_effort
         FROM ai_routing_state_routes
         WHERE state_id = $1 AND automation_id = $2 AND is_enabled = true
         ORDER BY rank ASC`,
        [selectedRoutingStateId, automationId]
      )
    : [];
  if (routes.length === 0) {
    usingRoutingStateRoutes = false;
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
      const pinConfiguredOpenCodePrimary =
        usingRoutingStateRoutes &&
        anchorProvider === "opencode" &&
        route.rank === 1 &&
        PINNED_OPENCODE_PRIMARY_AUTOMATIONS.has(automationId);
      const candidates = ROUND_ROBIN_POOL_PROVIDERS.has(anchorProvider) && !pinConfiguredOpenCodePrimary
        ? await getPoolKeyMetadata(anchorProvider, excludeKeyIds, benchmarkMode, keyScopedRecovery)
        : (anchor && !excludeKeyIds?.has(route.ai_key_id) ? [anchor] : []);

      for (const candidate of candidates) {
        const keyRow = candidate.id === anchor?.id
          ? anchor
          : await getAiKeyWithDecryptedKey(candidate.id);
        if (!keyRow || !keyRow.is_enabled || isKeyHealthBlocked(keyRow, keyScopedRecovery)) continue;
        if (excludeKeyModels?.has(keyModelId(keyRow.id, route.model_override ?? keyRow.model))) continue;

        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) {
          limitSkipped = true;
          if (!benchmarkMode) {
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
          }
          continue;
        }

        const effectiveModel = route.model_override ?? keyRow.model;
        const routeHealth = keyScopedRecovery && keyRow.provider === "opencode"
          ? await checkScheduledKeyModelHealth(automationId,keyRow.id,effectiveModel)
          : await checkRouteHealth(automationId, keyRow.provider, effectiveModel, route.rank);
        if (routeHealth.blocked) {
          limitSkipped = true;
          if (!benchmarkMode) {
            await recordUsageEvent({
              automationId,
              aiKeyId: keyRow.id,
              provider: keyRow.provider,
              model: effectiveModel ?? null,
              outcome: "skipped",
              latencyMs: 0,
              inputTokens: null,
              outputTokens: null,
              errorMessage: null,
              errorCode: routeHealth.reason ?? "route_health_cooldown",
              userId: null,
              workflowId: null,
              applicationId: null,
              attemptNumber: null,
              routeRank: route.rank,
            });
          }
          continue;
        }
        const provider = route.reasoning_effort
          ? buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config, route.reasoning_effort)
          : buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
        if (provider) {
          return {
            provider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: effectiveModel,
            reasoningEffort: route.reasoning_effort,
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
      const dbKeys = await getPoolKeyMetadata(route.provider, excludeKeyIds, benchmarkMode, keyScopedRecovery);
      for (const key of dbKeys) {
        if (isKeyHealthBlocked(key as any, keyScopedRecovery)) continue;
        const keyRow = await getAiKeyWithDecryptedKey(key.id);
        if (!keyRow) continue;
        if (excludeKeyModels?.has(keyModelId(keyRow.id, route.model_override ?? keyRow.model))) continue;

        const limitCheck = await checkKeyLimits(keyRow);
        if (!limitCheck.allowed) {
          limitSkipped = true;
          if (!benchmarkMode) {
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
          }
          continue;
        }

        const effectiveModel = route.model_override ?? keyRow.model;
        const routeHealth = keyScopedRecovery && keyRow.provider === "opencode"
          ? await checkScheduledKeyModelHealth(automationId,keyRow.id,effectiveModel)
          : await checkRouteHealth(automationId, keyRow.provider, effectiveModel, route.rank);
        if (routeHealth.blocked) {
          limitSkipped = true;
          if (!benchmarkMode) {
            await recordUsageEvent({
              automationId,
              aiKeyId: keyRow.id,
              provider: keyRow.provider,
              model: effectiveModel ?? null,
              outcome: "skipped",
              latencyMs: 0,
              inputTokens: null,
              outputTokens: null,
              errorMessage: null,
              errorCode: routeHealth.reason ?? "route_health_cooldown",
              userId: null,
              workflowId: null,
              applicationId: null,
              attemptNumber: null,
              routeRank: route.rank,
            });
          }
          continue;
        }
        const dbProvider = route.reasoning_effort
          ? buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config, route.reasoning_effort)
          : buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, effectiveModel, keyRow.base_url, keyRow.chat_endpoint, keyRow.custom_headers, keyRow.provider_config);
        if (dbProvider) {
          return {
            provider: dbProvider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: effectiveModel,
            reasoningEffort: route.reasoning_effort,
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
  const dbFallback = await getActiveProviderWithFallback(excludeKeyIds);
  if (dbFallback && !excludeProviderNames?.has(dbFallback.name)) {
    if (!benchmarkMode) {
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
    }
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
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
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
  stageRunId?: string;
  promptVersion?: string | null;
  attemptNumber?: number;
  routingStateId?: string;
  maxProviderAttempts?: number;
  /** Bounded chunk execution; ignored by all existing callers. */
  scheduledPoolRecovery?: boolean;
  deadlineAt?: number;
  // Set only by scripts/replay-pipeline-sample.ts (the offline A/B replay
  // harness). Suppresses every write this call would otherwise make against
  // live routing state - ai_usage_events rows, ai_api_keys health mutations,
  // and the round-robin pool cursor - so replaying a historical stage can
  // never perturb real routing decisions or reporting. Never set by any real
  // pipeline run.
  benchmarkMode?: boolean;
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

  const MAX_RETRIES = Math.max(0, (ctx?.maxProviderAttempts ?? 4) - 1);
  const runtime = await getAiRuntimeConfig();
  // When true, an attempt only counts against MAX_RETRIES when it advances to
  // a different route rank (a genuine model/provider chain advance). A retry
  // that lands on the same rank (a sibling account in a pooled provider's
  // pool, e.g. a different OpenCode credential for the same model) is
  // instead bounded by MAX_SAME_RANK_ITERATIONS below, so a 5+ account pool
  // can be fully tried for one model before the state's next model is ever
  // attempted. Off by default: every retry counts against MAX_RETRIES,
  // identical to the pre-existing behavior.
  const scheduledRecovery = ctx?.scheduledPoolRecovery === true && automationId === "scheduled_candidate_logging_eligibility_check";
  const boundRetriesByRouteRank = scheduledRecovery || runtime.pooled_retry_bounded_by_route_rank;
  // Runaway-loop safety valve for same-rank retries, not a tunable - today's
  // largest configured pool is a handful of accounts.
  const MAX_SAME_RANK_ITERATIONS = 50;

  const excludedKeyIds = new Set<string>(excludeKeyIds ?? []);
  const excludedProviders = new Set<string>();
  const excludedRouteIds = new Set<string>();
  const excludedKeyModels = new Set<string>();

  let lastError: Error | null = null;
  let lastResolved: AutomationRouteResult | null = null;
  let routeAdvances = 0;
  let sameRankRetries = 0;
  let previousRouteRank: number | null = null;
  let iteration = 0;

  while (true) {
    if (scheduledRecovery && ctx?.deadlineAt && Date.now() >= ctx.deadlineAt - 500) {
      throw new AiRouteCallError("Scheduled AI check deadline exceeded; retry in a later chunk.", {
        aiKeyId:lastResolved?.aiKeyId ?? null,provider:lastResolved?.name ?? "opencode",
        model:lastResolved?.model ?? null,routeRank:lastResolved?.routeRank ?? null,errorCode:"timeout",
      });
    }
    let resolved: AutomationRouteResult | null;
    try {
      resolved = await getProviderForAutomation(
        automationId,
        excludedKeyIds,
        iteration > 0 ? excludedProviders : undefined,
        excludedRouteIds,
        ctx?.routingStateId,
        excludedKeyModels,
        ctx?.benchmarkMode,
        scheduledRecovery,
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

    // Retry-budget accounting for every resolution after the first. A
    // same-rank resolution (a pooled provider's sibling account for the same
    // model) is only recognized as such when the flag is on; otherwise every
    // retry is treated as a chain advance, reproducing the pre-existing
    // MAX_RETRIES-counts-everything behavior exactly.
    if (iteration > 0) {
      const isSameRank = boundRetriesByRouteRank && resolved.routeRank === previousRouteRank;
      if (isSameRank) {
        sameRankRetries += 1;
        if (sameRankRetries > MAX_SAME_RANK_ITERATIONS) break;
      } else {
        routeAdvances += 1;
        sameRankRetries = 0;
        if (routeAdvances > MAX_RETRIES) break;
      }
    }
    previousRouteRank = resolved.routeRank;
    iteration += 1;

    lastResolved = resolved;
    const start = Date.now();
    let outcome: "success" | "failure" | "timeout" = "success";
    let errorMessage: string | null = null;
    let errorCode: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let capturedUsage: { input_tokens: number; output_tokens: number } | null = null;
    const traceIds: string[] = [];
    let requestSequence = 0;

    const wrappedProvider: AiProvider = {
      send: async (opts) => {
        const startedAt = new Date();
        const sequence = ++requestSequence;
        try {
          const remainingMs = scheduledRecovery && ctx?.deadlineAt ? ctx.deadlineAt - Date.now() : null;
          if (remainingMs !== null && remainingMs <= 0) throw new Error("Scheduled AI request timed out before sending.");
          const requestOptions = remainingMs === null ? opts : { ...opts, timeoutMs:Math.min(opts.timeoutMs ?? 30_000, remainingMs) };
          const response = await resolved.provider.send(requestOptions);
          if (response.usage) {
            // fn() may call send() more than once per agent run (e.g. Resume
            // Forge's job-only extraction + requirement analysis + draft).
            // Accumulate across every sub-call instead of overwriting.
            capturedUsage = {
              input_tokens: (capturedUsage?.input_tokens ?? 0) + response.usage.input_tokens,
              output_tokens: (capturedUsage?.output_tokens ?? 0) + response.usage.output_tokens,
            };
          }
          if (!ctx?.benchmarkMode) {
            const traceId = await recordAiCallTrace({
              automationId,
              aiKeyId: resolved.aiKeyId,
              provider: resolved.name,
              model: resolved.model ?? null,
              routeId: resolved.routeId ?? null,
              routeRank: resolved.routeRank,
              routingStateId: ctx?.routingStateId ?? null,
              userId: ctx?.userId ?? null,
              workflowId: ctx?.workflowId ?? null,
              applicationId: ctx?.applicationId ?? null,
              stageRunId: ctx?.stageRunId ?? null,
              promptVersion: ctx?.promptVersion ?? null,
              stageAttemptNumber: ctx?.attemptNumber ?? null,
              providerAttemptNumber: iteration,
              requestSequence: sequence,
              request: opts,
              response,
              outcome: "success",
              inputTokens: response.usage?.input_tokens ?? null,
              outputTokens: response.usage?.output_tokens ?? null,
              latencyMs: Date.now() - startedAt.getTime(),
              startedAt,
              completedAt: new Date(),
            });
            if (traceId) traceIds.push(traceId);
          }
          return response;
        } catch (err: any) {
          if (!ctx?.benchmarkMode) {
            const traceId = await recordAiCallTrace({
              automationId,
              aiKeyId: resolved.aiKeyId,
              provider: resolved.name,
              model: resolved.model ?? null,
              routeId: resolved.routeId ?? null,
              routeRank: resolved.routeRank,
              routingStateId: ctx?.routingStateId ?? null,
              userId: ctx?.userId ?? null,
              workflowId: ctx?.workflowId ?? null,
              applicationId: ctx?.applicationId ?? null,
              stageRunId: ctx?.stageRunId ?? null,
              promptVersion: ctx?.promptVersion ?? null,
              stageAttemptNumber: ctx?.attemptNumber ?? null,
              providerAttemptNumber: iteration,
              requestSequence: sequence,
              request: opts,
              response: null,
              outcome: classifyErrorCode(err) === "timeout" ? "timeout" : "failure",
              inputTokens: null,
              outputTokens: null,
              latencyMs: Date.now() - startedAt.getTime(),
              errorCode: classifyErrorCode(err),
              errorMessage: err?.message ?? "Provider request failed",
              startedAt,
              completedAt: new Date(),
            });
            if (traceId) traceIds.push(traceId);
          }
          throw err;
        }
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

      if (!ctx?.benchmarkMode) {
        const usageEventId = await recordUsageEvent({
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
        await linkAiCallTracesToUsageEvent(traceIds, usageEventId);
        if (resolved.aiKeyId) await recordAiKeySuccess(resolved.aiKeyId).catch(() => {});
      }

      return {
        result,
        providerName: resolved.name,
        aiKeyId: resolved.aiKeyId,
        model: resolved.model ?? null,
        routeRank: resolved.routeRank,
        limitSkipped: resolved.limitSkipped,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCost(resolved.name, resolved.model, inputTokens, outputTokens),
        latencyMs,
      };
    } catch (err: any) {
      lastError = err;
      const latencyMs = Date.now() - start;
      errorMessage = err.message ?? "Unknown error";
      errorCode = classifyErrorCode(err);
      // A slow malformed response is still an output failure, not a provider
      // timeout. Keeping this distinction makes the dashboard actionable and
      // lets the fallback policy handle bad model output consistently.
      outcome = errorCode === "timeout" ? "timeout" : "failure";

      if (capturedUsage) {
        const u: { input_tokens: number; output_tokens: number } = capturedUsage;
        inputTokens = u.input_tokens;
        outputTokens = u.output_tokens;
      }

      if (!ctx?.benchmarkMode) {
        const usageEventId = await recordUsageEvent({
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
        await linkAiCallTracesToUsageEvent(traceIds, usageEventId);
        // A provider can reject one model while the credential remains valid for
        // sibling model routes (e.g. OpenCode 403 "Model access is disabled").
        // Do not poison the shared key's health for a model-entitlement issue.
        if (resolved.aiKeyId && errorCode !== "model_unavailable") {
          await recordAiKeyFailure(resolved.aiKeyId, errorMessage ?? "Unknown provider error").catch(() => {});
        }
      }

      // Provider transport failures and invalid model output are retryable.
      // Invalid output must advance the route: a model can be reachable and
      // still fail to produce the structured payload the pipeline requires.
      const isRetriable = [
        "rate_limit",
        "billing_error",
        "auth_error",
        "model_unavailable",
        "timeout",
        "server_error",
        "not_found",
        "configuration_error",
        "invalid_output",
      ].includes(errorCode ?? "");

      if (isRetriable) {
        if (errorCode === "model_unavailable" && resolved.aiKeyId && resolved.model) {
          // 403 model-entitlement failures are specific to the model, not the
          // pooled credential. Keep other configured models on this key usable.
          excludedKeyModels.add(keyModelId(resolved.aiKeyId, resolved.model));
        } else if (errorCode === "auth_error") {
          if (resolved.aiKeyId) excludedKeyIds.add(resolved.aiKeyId);
          else if (resolved.name) excludedProviders.add(resolved.name);
        } else if (
          (errorCode === "rate_limit" ||
            errorCode === "timeout" ||
            errorCode === "invalid_output" ||
            errorCode === "configuration_error" ||
            errorCode === "not_found") &&
          resolved.aiKeyId &&
          ROUND_ROBIN_POOL_PROVIDERS.has(resolved.name)
        ) {
          // These failures are specific to the current model/request, not the
          // credential. Keep the exclusion scoped to key+model so a different
          // model on the same pooled account can still be attempted. This
          // already fixed the production timeout case; malformed output,
          // unsupported request settings, and missing model IDs have the same
          // scope. Authentication failures still exclude the credential.
          excludedKeyModels.add(keyModelId(resolved.aiKeyId, resolved.model));
        } else if (resolved.aiKeyId) {
          // Keep server_error key-wide: OpenCode's 530 tunnel-unavailable
          // response is treated as a gateway-level outage, unlike failures
          // that are model/request-specific above.
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
            `failed with ${errorCode}, retrying (route advances ${routeAdvances}/${MAX_RETRIES}` +
            (boundRetriesByRouteRank ? `, same-rank retries ${sameRankRetries}/${MAX_SAME_RANK_ITERATIONS})` : `)`)
        );
        continue;
      }

      break; // non-retriable
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

/**
 * Classifies a provider error into a retriable error category.
 *
 * Strategy (ordered by specificity):
 *  1. Error.name — catches fetch AbortError and DOMException reliably without
 *     touching the message string at all.
 *  2. Error.code — catches Node.js network errors (ECONNRESET, ECONNREFUSED,
 *     ETIMEDOUT) by their structured code property, not by text parsing.
 *  3. Embedded HTTP status code — all providers in this codebase produce error
 *     messages in the form "Provider API error (STATUS): body". Extracting the
 *     status code as a number is more reliable than substring-matching the body
 *     text, which changes per provider and per locale.
 *  4. Keyword fallback — last resort for any provider that deviates from the
 *     standard pattern above.
 */
export function classifyAiErrorCode(err: any): string | null {
  const name: string = err?.name ?? "";
  const code: string = err?.code ?? "";
  const msg: string = (err?.message ?? "").toLowerCase();

  // ── 1. Structured error name ────────────────────────────────────────────────
  if (name === "AbortError" || name === "TimeoutError") return "timeout";

  // ── 2. Node.js network error codes ─────────────────────────────────────────
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ENOTFOUND") return "server_error";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";

  // ── 3. Extract embedded HTTP status code from provider error messages ───────
  // All providers throw: `new Error("Label error (STATUS): body")`
  const httpStatusMatch = err?.message?.match(/\((\d{3})\)/);
  if (httpStatusMatch) {
    const status = Number(httpStatusMatch[1]);
    if (status === 401) return "auth_error";
    // OpenCode returns HTTP 402 when an individual account has exhausted its
    // balance. Treat it as key-scoped so the pool can rotate to another
    // account for the same model instead of failing the whole workflow.
    if (status === 402) return "billing_error";
    if (status === 403) {
      if (isModelAccessUnavailable(msg)) return "model_unavailable";
      return "auth_error";
    }
    if (status === 429) return "rate_limit";
    if (status === 404) return "not_found";
    if (status === 400 || status === 422) return "configuration_error";
    if (status === 408) return "timeout";
    if (status >= 500) return "server_error";
  }

  // ── 4. Keyword fallback for non-standard error shapes ───────────────────────
  if (isModelAccessUnavailable(msg)) return "model_unavailable";
  if (msg.includes("insufficient funds") || msg.includes("payment required")) return "billing_error";
  if (msg.includes("billing") && (msg.includes("balance") || msg.includes("credit"))) return "billing_error";
  if (msg.includes("aborted") || msg.includes("timed out") || msg.includes("timeout")) return "timeout";
  if (msg.includes("unauthorized") || msg.includes("invalid api key")) return "auth_error";
  if (msg.includes("rate limit") || msg.includes("quota")) return "rate_limit";
  if (msg.includes("not found")) return "not_found";
  if (msg.includes("server error") || msg.includes("service unavailable")) return "server_error";
  if (
    msg.includes("fetch failed") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("connection reset") ||
    msg.includes("econn")
  ) return "server_error";
  if (
    err?.name === "SyntaxError" ||
    err?.name === "ZodError" ||
    msg.includes("unexpected end of json") ||
    msg.includes("unterminated string") ||
    msg.includes("invalid json") ||
    msg.includes("invalid model output") ||
    msg.includes("output validation") ||
    msg.includes("schema validation") ||
    msg.includes("stopreason: max_tokens") // assertNotTruncated() - see its own comment
  ) return "invalid_output";
  return null;
}

/**
 * Phase 5 (2026-09-28): stopReason==="max_tokens" was never checked anywhere
 * in the pipeline - a truncated response's cut-off JSON just threw a plain
 * SyntaxError inside JSON.parse, classified as the generic "invalid_output"
 * and retried on the next route with the SAME token limit, with no signal in
 * the error message that the real cause was truncation rather than a
 * malformed/hallucinated response. Call this before JSON.parse in every
 * agent so the ai_usage_events row (and any human reading the log) can tell
 * the two apart. Deliberately classifies the same as "invalid_output" today
 * (still retryable, no behavior change) - the point of this pass is
 * detection/diagnosis, not a token-limit escalation policy.
 */
export function assertNotTruncated(response: { stopReason: string }, agentLabel: string): void {
  if (response.stopReason === "max_tokens") {
    throw new Error(
      `${agentLabel} output was truncated (stopReason: max_tokens) before it could be parsed as JSON - the response hit its token limit, this is not malformed output.`
    );
  }
}

function isModelAccessUnavailable(message: string): boolean {
  return (
    message.includes("model access is disabled") ||
    message.includes("model access disabled") ||
    message.includes("model is not enabled") ||
    message.includes("model is disabled for") ||
    message.includes("account does not have access to model")
  );
}

// Keep the internal call sites concise while exposing the classifier for a
// small regression test without exposing routing internals.
const classifyErrorCode = classifyAiErrorCode;

type AiCallTraceInput = {
  automationId: string;
  aiKeyId: string | null;
  provider: string;
  model: string | null;
  routeId: string | null;
  routeRank: number | null;
  routingStateId: string | null;
  userId: string | null;
  workflowId: string | null;
  applicationId: string | null;
  stageRunId: string | null;
  promptVersion: string | null;
  stageAttemptNumber: number | null;
  providerAttemptNumber: number;
  requestSequence: number;
  request: Parameters<AiProvider["send"]>[0];
  response: Awaited<ReturnType<AiProvider["send"]>> | null;
  outcome: "success" | "failure" | "timeout";
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt: Date;
  completedAt: Date;
};

function redactTraceError(message: unknown): string {
  return String(message ?? "Unknown provider error")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|authorization)["'\s:=]+)[^\s,"']+/gi, "$1[REDACTED]")
    .slice(0, 4000);
}

async function recordAiCallTrace(input: AiCallTraceInput): Promise<string | null> {
  try {
    // Capture the exact provider request object and normalized response before
    // agent parsing/post-processing. Credentials are added by the provider
    // adapter and are not part of AiProvider.send's request object.
    const requestPayload = {
      system: input.request.system,
      messages: input.request.messages,
      tools: input.request.tools,
      generation: {
        temperature: input.request.temperature ?? null,
        maxTokens: input.request.maxTokens ?? null,
        timeoutMs: input.request.timeoutMs ?? null,
        responseSchema: input.request.responseSchema ?? null,
        responseMimeType: input.request.responseMimeType ?? null,
      },
    };
    const responsePayload = input.response
      ? {
          content: input.response.content,
          stopReason: input.response.stopReason,
          usage: input.response.usage ?? null,
        }
      : null;
    const responseText = input.response?.content
      .filter((block) => block.type === "text")
      .map((block) => block.type === "text" ? block.text : "")
      .join("\n") ?? null;
    const requestJson = JSON.stringify(requestPayload);
    const responseJson = responsePayload ? JSON.stringify(responsePayload) : null;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO ai_call_traces (
         automation_id, provider, model, ai_key_id, route_id, route_rank,
         routing_state_id, triggered_by_user_id, application_id, workflow_id, stage_run_id,
         prompt_version, stage_attempt_number, provider_attempt_number,
         request_sequence, request_payload, response_payload, response_text,
         request_hash, response_hash, outcome, input_tokens, output_tokens,
         latency_ms, error_code, error_message, started_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16::jsonb, $17::jsonb, $18, md5($16::jsonb::text),
         CASE WHEN $17::jsonb IS NULL THEN NULL ELSE md5($17::jsonb::text) END,
         $19, $20, $21, $22, $23, $24, $25, $26
       ) RETURNING id`,
      [
        input.automationId,
        input.provider,
        input.model,
        input.aiKeyId,
        input.routeId,
        input.routeRank,
        input.routingStateId,
        input.userId,
        input.applicationId,
        input.workflowId,
        input.stageRunId,
        input.promptVersion,
        input.stageAttemptNumber,
        input.providerAttemptNumber,
        input.requestSequence,
        requestJson,
        responseJson,
        responseText,
        input.outcome,
        input.inputTokens,
        input.outputTokens,
        input.latencyMs,
        input.errorCode ?? null,
        input.errorMessage ? redactTraceError(input.errorMessage) : null,
        input.startedAt.toISOString(),
        input.completedAt.toISOString(),
      ],
    );
    return row?.id ?? null;
  } catch (err) {
    // Observability must never turn a successful provider response into a
    // failed pipeline stage. Keep prompt/response bodies out of error logs.
    console.error("[ai-call-trace] Failed to persist provider trace:", err instanceof Error ? err.message : "Unknown error");
    return null;
  }
}

async function linkAiCallTracesToUsageEvent(traceIds: string[], usageEventId: string | null): Promise<void> {
  if (!usageEventId || traceIds.length === 0) return;
  try {
    await execute(
      "UPDATE ai_call_traces SET usage_event_id = $1 WHERE id = ANY($2::uuid[])",
      [usageEventId, traceIds],
    );
  } catch (err) {
    console.error("[ai-call-trace] Failed to link provider trace to usage event:", err instanceof Error ? err.message : "Unknown error");
  }
}

export interface UsageEventInput {
  automationId: string;
  aiKeyId: string | null;
  provider: string;
  model: string | null;
  outcome: "success" | "failure" | "timeout" | "skipped" | "discarded";
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

export async function recordUsageEvent(input: UsageEventInput): Promise<string | null> {
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
    const row = await queryOne<{ id: string }>(
      `INSERT INTO ai_usage_events
        (automation_id, ai_key_id, provider, model, outcome,
         latency_ms, input_tokens, output_tokens, estimated_cost_usd,
         error_message, error_code, triggered_by_user_id,
         route_rank, attempt_number, workflow_id, application_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16::uuid)
       RETURNING id`,
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
    return row?.id ?? null;
  } catch (err) {
    console.error("[recordUsageEvent] Failed to record usage event (non-fatal):", err);
    return null;
  }
}
