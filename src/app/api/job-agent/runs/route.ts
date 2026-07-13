// src/app/api/job-agent/runs/route.ts
// GET  -> list recent runs
// POST -> trigger a scrape (auto-picks config + token from pool)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { listRuns } from "@/server/repositories/jobAgentRunRepository";
import { createPendingRun, executeRunFromRecord } from "@/server/services/jobAgentService";
import { runInBackground } from "@/lib/backgroundExecution";

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
  const roleGroups: string[] = Array.isArray(body.roleGroups) ? body.roleGroups.filter(Boolean) : [];
  const customKeywords: string[] = Array.isArray(body.customKeywords) ? body.customKeywords.filter(Boolean) : [];

  let result: { runId: string; config: any; roleGroups: string[]; token: any };
  try {
    result = await createPendingRun({ testMode, useAi, roleGroups, customKeywords });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Run failed" }, { status: 500 });
  }

  runInBackground(req, async () => {
    await executeRunFromRecord(result.runId, result.config, result.roleGroups, result.token, { testMode, useAi, customKeywords });
  });

  return NextResponse.json({ runId: result.runId, status: "pending" });
}