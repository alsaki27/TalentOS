// AI Key Manager v2 routing service.
// Replaces the 1-row-per-category model with per-automation fallback chains.
// Tracks every real AI call (not just admin test clicks) in ai_usage_events.

import { AiProvider, AiMessage, AiTool } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/ai/pricing";
import { query, queryOne, execute } from "@/server/db/neon";
import { listEnabledAiKeys, getAiKeyWithDecryptedKey, type AiProvider as DbAiProvider } from "@/server/repositories/aiKeyRepository";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";
import { getProviderByName, getActiveProviderAsync } from "@/lib/ai/index";

export interface AutomationRouteResult {
  provider: AiProvider;
  name: string;
  aiKeyId: string | null;
  automationId: string;
  model?: string | null;
}

interface AutomationRouteRow {
  id: string;
  automation_id: string;
  ai_key_id: string | null;
  provider: string | null;
  rank: number;
  is_enabled: boolean;
}

/**
 * Resolve a provider for the given automation by walking its ordered fallback chain.
 * Falls back to the global env-based chain if no routes are configured or all fail.
 */
export async function getProviderForAutomation(
  automationId: string
): Promise<AutomationRouteResult | null> {
  // 1. Load ordered enabled routes for this automation
  const routes = await query<AutomationRouteRow>(
    `SELECT * FROM ai_automation_routes
     WHERE automation_id = $1 AND is_enabled = $2
     ORDER BY rank ASC`,
    [automationId, true]
  );

  // 2. Try each route in order
  for (const route of routes) {
    if (route.ai_key_id) {
      const keyRow = await getAiKeyWithDecryptedKey(route.ai_key_id);
      if (!keyRow || !keyRow.is_enabled) continue;
      const provider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
      if (provider) {
        return {
          provider,
          name: keyRow.provider as AutomationRouteResult["name"],
          aiKeyId: keyRow.id,
          automationId,
          model: keyRow.model,
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
        };
      }
      // Try DB keys for this provider
      const dbKeys = await listEnabledAiKeys();
      for (const key of dbKeys) {
        if (key.provider !== route.provider) continue;
        const keyRow = await getAiKeyWithDecryptedKey(key.id);
        if (!keyRow) continue;
        const dbProvider = buildProviderFromDbKey(keyRow.provider, keyRow.decrypted_key, keyRow.model);
        if (dbProvider) {
          return {
            provider: dbProvider,
            name: keyRow.provider as AutomationRouteResult["name"],
            aiKeyId: keyRow.id,
            automationId,
            model: keyRow.model,
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
    };
  }

  return null;
}

/**
 * Wrapper that resolves a provider via D-AI.2.1, calls fn, and records a usage event.
 * Handles both success and failure paths. Token/cost fields populated when available.
 */
export async function callWithUsageTracking<T>(
  automationId: string,
  ctx: { userId?: string } | undefined,
  fn: (provider: AiProvider) => Promise<T>
): Promise<T> {
  const resolved = await getProviderForAutomation(automationId);
  if (!resolved) {
    throw new Error(`No AI provider available for automation: ${automationId}`);
  }

  const start = Date.now();
  let outcome: "success" | "failure" | "timeout" = "success";
  let errorMessage: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  try {
    const result = await fn(resolved.provider);
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
      userId: ctx?.userId ?? null,
    });

    return result;
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    errorMessage = err.message ?? "Unknown error";
    outcome = latencyMs > 60000 ? "timeout" : "failure";

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
      userId: ctx?.userId ?? null,
    });

    throw err;
  }
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
  userId: string | null;
}

async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  const cost = estimateCost(input.provider, input.model, input.inputTokens, input.outputTokens);

  await execute(
    `INSERT INTO ai_usage_events
      (automation_id, ai_key_id, provider, model, outcome,
       latency_ms, input_tokens, output_tokens, estimated_cost_usd,
       error_message, triggered_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      input.userId,
    ]
  );
}
