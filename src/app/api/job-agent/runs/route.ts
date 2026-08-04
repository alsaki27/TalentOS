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

  const results: { runId: string; actorSource: string; status: string }[] = [];

  for (const actorSource of actorSources) {
    let result: { runId: string; config: any; roleGroups: string[]; token: any };
    try {
      result = await createPendingRun({ testMode, useAi, roleGroups, customKeywords, dateInterval, actorSource: actorSource as any });
      // Fire-and-forget — cron will poll for completion
      executeRunFromRecord(result.runId, result.config, result.roleGroups, result.token, { testMode, useAi, customKeywords, dateInterval, actorSource: actorSource as any }).catch((err) => {
        console.error(`[job-agent/runs] executeRunFromRecord failed for actor=${actorSource}:`, err.message);
      });
      results.push({ runId: result.runId, actorSource, status: "pending" });
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? "Run failed", actorSource }, { status: 500 });
    }
  }

  // If only one actor, return in legacy shape for backward compatibility
  if (results.length === 1) {
    return NextResponse.json({ runId: results[0].runId, status: "pending" });
  }
  return NextResponse.json({ runs: results });
}