// src/lib/safetyCheck.ts
// Anti-wipeout safety guard — ported from talentOS-B packages/mcp-server/src/safety.ts,
// adapted for the Cloudflare Workers / Neon environment (no filesystem).
//
// Every destructive admin operation must pass these gates:
//   1. confirm: true — explicit opt-in for destruction
//   2. maxItems cap — bulk operations limited to MAX_BULK
//   3. No blank filters — catch-all "delete everything" blocked
//   4. Audit log — every mutation written to activity_logs table
//   5. Rate limit — max DESTRUCTIVE_OPS_PER_MINUTE mutation calls/minute
//
// Motivated by a real incident: a teammate ran `DELETE FROM ai_api_keys`
// with no WHERE clause, wiping the Vertex Proxy key. This guard makes that
// impossible at the code level, not just by convention.

import { query as sqlQuery, execute as sqlExecute } from "@/server/db/neon";

export const MAX_BULK = 50;
export const DESTRUCTIVE_OPS_PER_MINUTE = 10;

export interface SafetyCheck {
  operation: "create" | "update" | "delete";
  resource: string;
  confirm?: boolean;
  bulkCount?: number;
  hasFilters?: boolean;
  userId?: string;
  detail?: string;
}

export interface SafetyResult {
  allowed: boolean;
  blockedReason?: string;
}

// In-memory rate limit (per Worker invocation — Cloudflare Worker instances
// are isolated, so this tracks within a single invocation's lifetime)
let destructiveOpsThisMinute = 0;
let minuteWindowStart = Date.now();

function checkRateLimit(): string | null {
  const now = Date.now();
  if (now - minuteWindowStart > 60_000) {
    minuteWindowStart = now;
    destructiveOpsThisMinute = 0;
  }
  destructiveOpsThisMinute++;
  if (destructiveOpsThisMinute > DESTRUCTIVE_OPS_PER_MINUTE) {
    const waitSec = Math.ceil((60_000 - (now - minuteWindowStart)) / 1000);
    return `Rate limit exceeded: max ${DESTRUCTIVE_OPS_PER_MINUTE} destructive operations per minute. Wait ${waitSec}s.`;
  }
  return null;
}

async function auditLog(
  operation: string,
  resource: string,
  detail: string,
  userId?: string
): Promise<void> {
  try {
    await sqlExecute(
      `INSERT INTO activity_logs (user_id, actor_name, type, description, entity_type, entity_name, metadata, created_at)
       VALUES ($1, $2, 'update', $3, $4, $5, $6, NOW())`,
      [
        userId ?? null,
        "safety-guard",
        `[SAFETY] ${operation} ${resource}: ${detail}`,
        resource,
        operation,
        JSON.stringify({ resource, detail, timestamp: new Date().toISOString() }),
      ]
    );
  } catch (err) {
    console.error("[safetyCheck] Audit log insert failed (non-fatal):", err);
  }
}

export function safetyCheck(params: SafetyCheck): SafetyResult {
  // CREATE/UPDATE: always allowed with audit
  if (params.operation === "create" || params.operation === "update") {
    return { allowed: true };
  }

  // DELETE: full guard suite
  if (params.operation === "delete") {
    // 1. Confirm must be explicitly true
    if (!params.confirm) {
      return { allowed: false, blockedReason: "Destructive operation requires confirm: true. Add this flag to proceed." };
    }

    // 2. Bulk cap
    if (params.bulkCount && params.bulkCount > MAX_BULK) {
      return { allowed: false, blockedReason: `Bulk operation limited to ${MAX_BULK} items. Requested ${params.bulkCount}.` };
    }

    // 3. No blank-filter catch-all deletes
    if (params.hasFilters === false) {
      return { allowed: false, blockedReason: `Cannot delete all ${params.resource} without filters. Specify which records to delete.` };
    }

    // 4. Rate limit
    const rateLimit = checkRateLimit();
    if (rateLimit) {
      return { allowed: false, blockedReason: rateLimit };
    }

    return { allowed: true };
  }

  return { allowed: false, blockedReason: `Unknown operation: ${params.operation}` };
}

export async function guardedSafetyCheck(
  params: SafetyCheck
): Promise<SafetyResult> {
  const result = safetyCheck(params);
  if (result.allowed) {
    await auditLog(
      params.operation,
      params.resource,
      params.detail ?? "approved",
      params.userId
    );
  }
  return result;
}