// src/app/api/cron/job-agent/route.ts
// Authoritative entry point for the idempotent Asia/Dhaka nightly batch.

import { NextRequest, NextResponse } from "next/server";
import { getBatchProgress } from "@/server/repositories/jobAgentBatchRepository";
import { startOrResumeNightlyBatch } from "@/server/services/jobAgentNightlyService";
import {
  recordJobAttempt,
  recordJobFailure,
  recordJobSuccess,
} from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Create or resume the canonical Dhaka business-date batch. The service and
 * database batch key make repeated cron/recovery calls idempotent.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  await recordJobAttempt("job-agent");

  try {
    let body: unknown = {};
    const rawBody = await req.text();
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }
    }

    if (body === null || Array.isArray(body) || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    if (input.autoImport !== undefined) {
      return NextResponse.json({
        error: "autoImport is controlled by the scheduled launcher and cannot be set manually",
      }, { status: 400 });
    }
    if (input.businessDate !== undefined && typeof input.businessDate !== "string") {
      return NextResponse.json({ error: "businessDate must be a YYYY-MM-DD string" }, { status: 400 });
    }

    const invocationHeader = req.headers.get("x-job-agent-invocation")?.trim().toLowerCase();
    if (invocationHeader && !["scheduled", "manual", "recovery"].includes(invocationHeader)) {
      return NextResponse.json({ error: "Invalid x-job-agent-invocation header" }, { status: 400 });
    }
    const invocationType = invocationHeader === "scheduled"
      ? "scheduled"
      : invocationHeader === "recovery"
        ? "recovery"
        : "manual";
    const result = await startOrResumeNightlyBatch({
      businessDate: input.businessDate as string | undefined,
      invocationType,
      requestId: req.headers.get("x-job-agent-request-id") ?? undefined,
    });

    const summary = {
      expectedShards: result.batch.expected_shards,
      terminalShards: result.batch.terminal_shards,
      succeededShards: result.batch.succeeded_shards,
      failedShards: result.batch.failed_shards,
      rawCount: result.batch.raw_count,
      acceptedCount: result.batch.accepted_count,
      dateExcludedCount: result.batch.date_excluded_count,
      duplicateCount: result.batch.duplicate_count,
      classifiedCount: result.batch.classified_count,
      importedCount: result.batch.imported_count,
    };

    await recordJobSuccess(
      "job-agent",
      Date.now() - startedMs,
      JSON.stringify({ batchId: result.batch.id, created: result.created, ...summary })
    );

    return NextResponse.json({
      ok: true,
      created: result.created,
      batchId: result.batch.id,
      batch: result.batch,
      shards: result.shards,
      summary,
      launchResults: result.launchResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobFailure("job-agent", message, Date.now() - startedMs).catch(() => undefined);
    console.error("[job-agent-nightly] Start/resume failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Return durable batch/shard/retry/filtering/handoff progress. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchId = req.nextUrl.searchParams.get("batchId")?.trim() ?? "";
  if (!batchId) {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }
  if (!isUuid(batchId)) {
    return NextResponse.json({ error: "batchId must be a valid UUID" }, { status: 400 });
  }

  try {
    const progress = await getBatchProgress(batchId);
    if (!progress) {
      return NextResponse.json({ error: "Nightly batch not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      batchId: progress.batch.id,
      ...progress,
      summary: {
        expectedShards: progress.batch.expected_shards,
        terminalShards: progress.batch.terminal_shards,
        succeededShards: progress.batch.succeeded_shards,
        failedShards: progress.batch.failed_shards,
        rawCount: progress.batch.raw_count,
        acceptedCount: progress.batch.accepted_count,
        dateExcludedCount: progress.batch.date_excluded_count,
        dateExclusionReasons: progress.batch.date_exclusion_reasons,
        duplicateCount: progress.batch.duplicate_count,
        classifiedCount: progress.batch.classified_count,
        importedCount: progress.batch.imported_count,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[job-agent-nightly] Progress lookup failed for ${batchId}:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
