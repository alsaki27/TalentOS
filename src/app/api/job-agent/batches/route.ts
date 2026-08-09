import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import {
  listBatchShards,
  listRecentBatches,
  type JobAgentBatchShardRow,
} from "@/server/repositories/jobAgentBatchRepository";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const ACTOR_SOURCES = ["indeed", "linkedin", "google"] as const;
const TERMINAL_SHARD_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

interface TierCountRow {
  batch_id: string;
  best_count: number | string;
  medium_count: number | string;
  worthy_count: number | string;
  skip_count: number | string;
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actorProgress(shards: JobAgentBatchShardRow[]) {
  return Object.fromEntries(
    ACTOR_SOURCES.map((actor) => {
      const actorShards = shards.filter((shard) => shard.actor_source === actor);
      return [actor, {
        total: actorShards.length,
        terminal: actorShards.filter((shard) => TERMINAL_SHARD_STATUSES.has(shard.status)).length,
        succeeded: actorShards.filter((shard) => shard.status === "succeeded").length,
        failed: actorShards.filter((shard) => shard.status === "failed" || shard.status === "cancelled").length,
        retrying: actorShards.filter((shard) => shard.status === "retry_wait").length,
        active: actorShards.filter((shard) => ["launching", "running", "processing"].includes(shard.status)).length,
        attempts: actorShards.reduce((sum, shard) => sum + shard.attempt_count, 0),
      }];
    })
  );
}

function publicShard(shard: JobAgentBatchShardRow) {
  return {
    id: shard.id,
    shard_key: shard.shard_key,
    logical_order: shard.logical_order,
    actor_source: shard.actor_source,
    role_groups: shard.role_groups,
    search_queries: shard.search_queries,
    allocated_result_limit: shard.allocated_result_limit,
    status: shard.status,
    attempt_count: shard.attempt_count,
    max_attempts: shard.max_attempts,
    next_retry_at: shard.next_retry_at,
    raw_count: shard.raw_count,
    accepted_count: shard.accepted_count,
    date_excluded_count: shard.date_excluded_count,
    date_exclusion_reasons: shard.date_exclusion_reasons,
    duplicate_count: shard.duplicate_count,
    classified_count: shard.classified_count,
    imported_count: shard.imported_count,
    last_error: shard.last_error,
  };
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const requestedLimit = Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "10", 10);
  const limit = Math.min(25, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));

  try {
    const batches = await listRecentBatches(limit);
    const shardLists = await Promise.all(batches.map((batch) => listBatchShards(batch.id)));
    const batchIds = batches.map((batch) => batch.id);
    const tierRows = batchIds.length === 0
      ? []
      : await query<TierCountRow>(
        `SELECT
           bs.batch_id,
           COUNT(*) FILTER (WHERE staged.tier = 'best')::int AS best_count,
           COUNT(*) FILTER (WHERE staged.tier = 'medium')::int AS medium_count,
           COUNT(*) FILTER (WHERE staged.tier = 'worthy')::int AS worthy_count,
           COUNT(*) FILTER (WHERE staged.tier = 'skip')::int AS skip_count
         FROM job_agent_batch_shards bs
         JOIN job_agent_runs runs ON runs.id = bs.last_run_id
         JOIN job_agent_staged_jobs staged ON staged.run_id = runs.id
         WHERE bs.batch_id = ANY($1::uuid[])
           AND bs.status = 'succeeded'
           AND staged.date_window_status = 'in_window'
         GROUP BY bs.batch_id`,
        [batchIds]
      );
    const tiersByBatch = new Map(tierRows.map((row) => [row.batch_id, {
      best: numberValue(row.best_count),
      medium: numberValue(row.medium_count),
      worthy: numberValue(row.worthy_count),
      skip: numberValue(row.skip_count),
    }]));

    return NextResponse.json({
      batches: batches.map((batch, index) => {
        const shards = shardLists[index];
        return {
          id: batch.id,
          batch_key: batch.batch_key,
          business_date: batch.business_date,
          timezone: batch.timezone,
          window_start: batch.window_start,
          window_end: batch.window_end,
          trigger_type: batch.trigger_type,
          auto_import: batch.auto_import,
          status: batch.status,
          expected_shards: batch.expected_shards,
          terminal_shards: batch.terminal_shards,
          succeeded_shards: batch.succeeded_shards,
          failed_shards: batch.failed_shards,
          raw_count: batch.raw_count,
          accepted_count: batch.accepted_count,
          date_excluded_count: batch.date_excluded_count,
          date_exclusion_reasons: batch.date_exclusion_reasons,
          duplicate_count: batch.duplicate_count,
          classified_count: batch.classified_count,
          imported_count: batch.imported_count,
          last_error: batch.last_error,
          errors: batch.errors,
          job_ceo_run_id: batch.job_ceo_run_id,
          started_at: batch.started_at,
          completed_at: batch.completed_at,
          tier_counts: tiersByBatch.get(batch.id) ?? { best: 0, medium: 0, worthy: 0, skip: 0 },
          actor_progress: actorProgress(shards),
          shards: shards.map(publicShard),
        };
      }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load nightly batches";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
