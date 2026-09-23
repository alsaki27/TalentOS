// src/app/api/job-agent/runs/route.ts
// GET  -> list recent runs
// POST -> trigger a scrape (auto-picks config + token from pool)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listRuns } from "@/server/repositories/jobAgentRunRepository";
import { createPendingRun, executeRunFromRecord } from "@/server/services/jobAgentService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const configId = url.searchParams.get("configId") || undefined;
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));

  try {
    const runs = await listRuns({ configId, limit });
    return NextResponse.json(runs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load runs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const testMode = body.testMode === true;
  const useAi = body.useAi !== false;
  const dateInterval = typeof body.dateInterval === "string" ? body.dateInterval : "today";
  const roleGroups: string[] = Array.isArray(body.roleGroups) ? body.roleGroups.filter(Boolean) : [];
  const customKeywords: string[] = Array.isArray(body.customKeywords) ? body.customKeywords.filter(Boolean) : [];
  // actorSources: array of actor keys ("indeed", "google", "linkedin"). Default to ["indeed"].
  const actorSources: string[] = Array.isArray(body.actorSources) && body.actorSources.length > 0
    ? body.actorSources.filter((s: unknown) => typeof s === "string" && ["indeed", "google", "linkedin"].includes(s as string))
    : ["indeed"];

  const results: { runId: string; actorSource: string; status: string; error?: string }[] = [];

  for (const actorSource of actorSources) {
    let result: { runId: string; config: any; roleGroups: string[]; token: any };
    try {
      result = await createPendingRun({ testMode, useAi, roleGroups, customKeywords, dateInterval, actorSource: actorSource as any });
    } catch (err: any) {
      results.push({ runId: "n/a", actorSource, status: "failed", error: err.message ?? "createPendingRun failed" });
      continue;
    }

    try {
      // IMPORTANT: We AWAIT this so the Apify run_id is written to the DB before
      // the HTTP response returns. In serverless environments (Vercel/Cloudflare),
      // background promises are killed when the response is sent. Without await,
      // apify_run_id is never saved, and the cron poller instantly marks the run
      // as "Missing Apify metadata".
      await executeRunFromRecord(
        result.runId,
        result.config,
        result.roleGroups,
        result.token,
        { testMode, useAi, customKeywords, dateInterval, actorSource: actorSource as any }
      );
      results.push({ runId: result.runId, actorSource, status: "running" });
    } catch (err: any) {
      console.error(`[job-agent/runs] executeRunFromRecord failed for actor=${actorSource}:`, err.message);
      // Run record already has failed status written inside executeRunFromRecord — just report it.
      results.push({ runId: result.runId, actorSource, status: "failed", error: err.message ?? "executeRunFromRecord failed" });
    }
  }

  // If only one actor, return in legacy shape for backward compatibility
  if (results.length === 1) {
    return NextResponse.json({ runId: results[0].runId, status: "pending" });
  }
  return NextResponse.json({ runs: results });
}