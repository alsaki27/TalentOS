// src/server/repositories/jobSourceRepository.ts
// Data access for job_sources / job_source_usage (sql/neon_fixes/043_job_sources.sql).
// Mirrors the shape of aiAgentConfigRepository.ts / routing.ts's checkKeyLimits —
// same budget-guardrail pattern, applied to job-data providers instead of AI providers.

import { query, queryOne, execute } from "@/server/db/neon";

export interface JobSourceRow {
  id: string;
  label: string;
  adapter_type: string;
  is_enabled: boolean;
  credentials_ref: string | null;
  base_url: string | null;
  cost_per_record_usd: number | null;
  monthly_budget_limit_usd: number | null;
  daily_request_limit: number | null;
  rate_limit_per_second: number | null;
  schedule_cron: string | null;
  role_groups: string[];
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `
  id, label, adapter_type, is_enabled, credentials_ref, base_url,
  cost_per_record_usd, monthly_budget_limit_usd, daily_request_limit,
  rate_limit_per_second, schedule_cron, role_groups, config, created_at, updated_at
`;

export async function listJobSources(opts: { enabledOnly?: boolean } = {}): Promise<JobSourceRow[]> {
  if (opts.enabledOnly) {
    return query<JobSourceRow>(`SELECT ${COLUMNS} FROM job_sources WHERE is_enabled = true ORDER BY id`);
  }
  return query<JobSourceRow>(`SELECT ${COLUMNS} FROM job_sources ORDER BY id`);
}

export async function getJobSource(id: string): Promise<JobSourceRow | null> {
  return queryOne<JobSourceRow>(`SELECT ${COLUMNS} FROM job_sources WHERE id = $1`, [id]);
}

export async function setJobSourceEnabled(id: string, enabled: boolean): Promise<void> {
  await execute(`UPDATE job_sources SET is_enabled = $1, updated_at = now() WHERE id = $2`, [enabled, id]);
}

export async function updateJobSourceBudget(
  id: string,
  budget: { monthlyBudgetLimitUsd?: number | null; dailyRequestLimit?: number | null }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (budget.monthlyBudgetLimitUsd !== undefined) {
    fields.push(`monthly_budget_limit_usd = $${idx++}`);
    values.push(budget.monthlyBudgetLimitUsd);
  }
  if (budget.dailyRequestLimit !== undefined) {
    fields.push(`daily_request_limit = $${idx++}`);
    values.push(budget.dailyRequestLimit);
  }
  if (fields.length === 0) return;
  fields.push(`updated_at = now()`);
  values.push(id);
  await execute(`UPDATE job_sources SET ${fields.join(", ")} WHERE id = $${idx}`, values);
}

/**
 * Same shape as routing.ts's checkKeyLimits — call before dispatching to a
 * source so a budget cap actually stops spend instead of just being
 * decorative in the admin UI.
 */
export async function checkSourceBudget(source: JobSourceRow): Promise<{ allowed: boolean; reason?: string }> {
  if (source.daily_request_limit) {
    const today = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM job_source_usage
       WHERE source_id = $1 AND created_at >= CURRENT_DATE`,
      [source.id]
    );
    if (today && today.count >= source.daily_request_limit) {
      return { allowed: false, reason: "daily_request_limit_reached" };
    }
  }

  if (source.monthly_budget_limit_usd) {
    const monthSpend = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text as total FROM job_source_usage
       WHERE source_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [source.id]
    );
    // Cast to Number explicitly — routing.ts's checkKeyLimits hit a real bug
    // comparing numeric-as-string columns with >= (lexicographic, not
    // numeric, comparison). Don't repeat that here.
    const spent = Number(monthSpend?.total ?? 0);
    const limit = Number(source.monthly_budget_limit_usd);
    if (Number.isFinite(spent) && Number.isFinite(limit) && spent >= limit) {
      return { allowed: false, reason: "monthly_budget_exhausted" };
    }
  }

  return { allowed: true };
}

export interface RecordSourceUsageInput {
  sourceId: string;
  runId: string | null;
  recordsFetched: number;
  recordsStaged: number;
  estimatedCostUsd: number;
  outcome: "success" | "failure" | "skipped_budget";
  errorMessage?: string | null;
  latencyMs?: number | null;
}

export async function recordSourceUsage(input: RecordSourceUsageInput): Promise<void> {
  await execute(
    `INSERT INTO job_source_usage
      (source_id, run_id, records_fetched, records_staged, estimated_cost_usd, outcome, error_message, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.sourceId,
      input.runId,
      input.recordsFetched,
      input.recordsStaged,
      input.estimatedCostUsd,
      input.outcome,
      input.errorMessage ?? null,
      input.latencyMs ?? null,
    ]
  );
}

/** Per-source rollup for the "which sources are actually worth paying for" dashboard. */
export async function getSourceUsageSummary(days = 30): Promise<
  Array<{ source_id: string; total_fetched: number; total_staged: number; total_cost_usd: number; run_count: number }>
> {
  return query(
    `SELECT source_id,
            SUM(records_fetched)::int as total_fetched,
            SUM(records_staged)::int as total_staged,
            SUM(estimated_cost_usd)::numeric as total_cost_usd,
            COUNT(*)::int as run_count
     FROM job_source_usage
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY source_id
     ORDER BY total_cost_usd DESC`,
    [days]
  );
}
