// src/app/api/admin/retriage-email-backlog/route.ts
// POST -> re-apply Chunk A's deterministic filter rules to already-stored
// candidate email, dismissing action_items the new rules would never have
// created. Defaults to a dry run - pass ?apply=true to actually write.
//
// CRON_SECRET-protected like every other /api/cron/* and /api/admin/*
// automation endpoint (auth copied verbatim from
// src/app/api/admin/retry-failed-since/route.ts) - not meant to be called
// from the browser. Deliberately NOT on any cron schedule: trigger by hand
// (or via the scheduled-jobs.yml workflow_dispatch input) once, looping
// until `remaining` hits 0.

import { NextRequest, NextResponse } from "next/server";
import { retriageEmailBacklog } from "@/server/services/emailRetriageService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "true";
  const batchId = url.searchParams.get("batchId") || `retriage-${new Date().toISOString()}`;
  const candidateId = url.searchParams.get("candidateId") || null;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(2000, Math.max(1, parseInt(limitParam, 10) || 500)) : undefined;
  const applyPolicySeed = url.searchParams.get("applyPolicySeed") === "true";

  try {
    const report = await retriageEmailBacklog({
      dryRun: !apply,
      batchId,
      candidateId,
      limit,
      applyPolicySeed,
    });
    return NextResponse.json(report);
  } catch (error: any) {
    console.error("[retriage-email-backlog] Failed:", error);
    return NextResponse.json({ error: error.message || "Retriage failed." }, { status: 500 });
  }
}
