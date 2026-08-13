// src/server/services/emailApprovalPolicy.ts
// Reads ai_agent_configs.approval_policy for 'email_triage' and turns it
// into an actual runtime decision.
//
// ai_agent_configs already has approval_policy (auto/risk_based/
// always_human), minimum_score, is_active, a seeded row for email_triage,
// and a fully built admin CRUD UI at /admin/ai - but nothing at runtime
// ever reads it (src/lib/ai/routing.ts has zero references to any of these
// columns). Closing that gap here is what turns "switch to fully-autonomous
// AI" into a one-row edit in the existing admin UI instead of a code change
// and a redeploy.

import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import {
  AUTO_WRITE_CATEGORIES,
  AUTO_WRITE_CONFIDENCE_THRESHOLD,
  APPLICATION_CONFIRMATION_CONFIDENCE,
  type EmailCategory,
} from "@/lib/ai/emailTriage";

const AUTOMATION_ID = "email_triage";

// Module-scope cache with a 60s TTL, not per-request: triageStoredMessage
// runs once per message inside a per-account sync loop, so a request-scoped
// lookup would mean a DB round trip per email. Module scope persists across
// invocations within the same Worker isolate, and a 60s TTL means an admin
// toggling the policy in /admin/ai takes effect within a minute with no
// redeploy - the whole point of driving this from a DB row instead of an
// envFlag() (wrangler.toml vars are plaintext and require one).
const TTL_MS = 60_000;
let cached: { value: EmailTriagePolicy; at: number } | null = null;

export type ApprovalPolicy = "auto" | "risk_based" | "always_human";

export interface EmailTriagePolicy {
  policy: ApprovalPolicy;
  /** Normalized 0..1. Only meaningful for the risk_based policy. */
  threshold: number;
  isActive: boolean;
  loadedFrom: "config" | "default";
}

// minimum_score is numeric(3,1) - it cannot store 0.85 (rounds to 0.9), so
// the column is meant to hold a 0-10 scale value instead (8.5 == 0.85).
// Neon also returns numeric columns as strings, not numbers - this exact
// bug class is already documented twice elsewhere in this repo
// (src/lib/ai/routing.ts, applicationAiWorkflowService.ts). 0/null/non-
// numeric means "not configured" and falls back rather than being treated
// as a literal zero threshold, which would auto-write everything.
export function normalizeMinimumScore(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n > 1 ? n / 10 : n;
}

export async function loadEmailTriagePolicy(force = false): Promise<EmailTriagePolicy> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const row = await findAgentConfigByAutomationId(AUTOMATION_ID);
  const value: EmailTriagePolicy = row
    ? {
        policy: row.approval_policy === "auto" || row.approval_policy === "always_human" ? row.approval_policy : "risk_based",
        threshold: normalizeMinimumScore(row.minimum_score, AUTO_WRITE_CONFIDENCE_THRESHOLD),
        isActive: row.is_active,
        loadedFrom: "config",
      }
    : {
        // Config row missing -> fall back to the exact pre-Chunk-D behavior.
        policy: "risk_based",
        threshold: AUTO_WRITE_CONFIDENCE_THRESHOLD,
        isActive: true,
        loadedFrom: "default",
      };

  cached = { value, at: Date.now() };
  return value;
}

export type StatusWriteAction = "auto_write" | "propose" | "skip";

export function decideStatusWrite(
  policy: EmailTriagePolicy,
  opts: { category: string; confidence: number; hasMatchedApplication: boolean; stageTarget: string | null },
): { action: StatusWriteAction; rule: string } {
  if (!opts.hasMatchedApplication || !opts.stageTarget) {
    return { action: "skip", rule: "no_stage_target_or_application" };
  }
  // Fail closed: a disabled agent must never auto-write, regardless of
  // policy - is_active is the kill switch, and it overrides everything else.
  if (!policy.isActive) {
    return { action: "propose", rule: "agent_inactive" };
  }
  if (policy.policy === "always_human") {
    return { action: "propose", rule: "policy_always_human" };
  }
  if (policy.policy === "auto") {
    return { action: "auto_write", rule: "policy_auto" };
  }

  // risk_based: application_confirmation keeps its own, separate, higher
  // confidence bar - unrelated to the admin-configured threshold, which
  // only governs interview/offer/rejection. See emailTriage.ts.
  const eligibleCategory = AUTO_WRITE_CATEGORIES.has(opts.category as EmailCategory) || opts.category === "application_confirmation";
  if (!eligibleCategory) {
    return { action: "propose", rule: "risk_based_ineligible_category" };
  }
  const threshold = opts.category === "application_confirmation" ? APPLICATION_CONFIRMATION_CONFIDENCE : policy.threshold;
  if (opts.confidence >= threshold) {
    return { action: "auto_write", rule: "risk_based_threshold_met" };
  }
  return { action: "propose", rule: "risk_based_below_threshold" };
}
