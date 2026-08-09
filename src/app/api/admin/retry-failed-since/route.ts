// src/app/api/admin/retry-failed-since/route.ts
// POST -> bulk-retry everything that failed during the Vertex gateway
// outage window earlier today (stale ai_key_id routing -> gateway auth
// header mismatch -> stale Cloudflare secret, now all fixed). Covers the
// two surfaces confirmed broken during that window:
//   1. application_ai_workflows (Job Lens/Resume Forge/Hiring
//      Panel/Final Polish pipeline) in status='failed'.
//   2. job_match_scores rows with score=-1 (the error sentinel
//      storeErrorScore() writes in /api/jobs/match-score).
// Both just get re-queued/re-triggered here — same underlying agents,
// same automations, only re-run now that the gateway actually works.
//
// CRON_SECRET-protected like every other /api/cron/* and /api/admin/*
// automation endpoint - not meant to be called from the browser.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { retryWorkflow } from "@/server/services/applicationAiWorkflowService";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  // Default cutoff: today 20:00 UTC - covers the whole incident window
  // (stale ai_key_id -> gateway header bug -> stale CF secret) without
  // sweeping up genuinely older, unrelated failures.
  const since = url.searchParams.get("since") ?? `${new Date().toISOString().slice(0, 10)}T20:00:00Z`;

  // ── 1. Failed application_ai_workflows ──
  const failedWorkflows = await query<{ id: string }>(
    `SELECT id FROM application_ai_workflows WHERE status = 'failed' AND created_at >= $1`,
    [since]
  );

  let workflowsRetried = 0;
  for (const wf of failedWorkflows ?? []) {
    try {
      await retryWorkflow(wf.id);
      workflowsRetried++;
    } catch (err) {
      console.error(`[retry-failed-since] Failed to retry workflow ${wf.id}:`, err);
    }
  }

  // ── 2. Failed job_match_scores (score = -1 error sentinel) ──
  const failedScores = await query<{ job_id: string; candidate_id: string; base_resume_id: string | null }>(
    `SELECT job_id, candidate_id, base_resume_id FROM job_match_scores WHERE score = -1 AND updated_at >= $1`,
    [since]
  );

  const baseUrl = process.env.TALENTOS_BASE_URL || "https://talent.skarion.com";
  let scoresRetried = 0;
  const scoreErrors: { job_id: string; candidate_id: string; detail: string }[] = [];
  for (const s of failedScores ?? []) {
    try {
      const res = await fetch(`${baseUrl}/api/jobs/match-score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // match-score is normally reached via a logged-in session, not
          // CRON_SECRET - this server-to-server call has no session cookie,
          // so it needs the same bearer bypass middleware.ts grants the
          // other automation endpoints (see isOpenJobDataIngestAuthorized).
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          job_id: s.job_id,
          candidate_id: s.candidate_id,
          base_resume_id: s.base_resume_id,
          force_rescore: true,
        }),
      });
      if (res.ok) {
        scoresRetried++;
      } else {
        const body = await res.text().catch(() => "");
        scoreErrors.push({ job_id: s.job_id, candidate_id: s.candidate_id, detail: `HTTP ${res.status}: ${body.slice(0, 300)}` });
      }
    } catch (err: any) {
      scoreErrors.push({ job_id: s.job_id, candidate_id: s.candidate_id, detail: err?.message ?? String(err) });
    }
  }

  // One dispatch call kicks the workflow queue - the existing 5-minute
  // dispatch-workflows cron will pick up the rest, this just doesn't make
  // the caller wait for it.
  if (workflowsRetried > 0) {
    await backgroundDispatch(
      fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, { method: "POST" }).catch((err) => {
        console.error("[retry-failed-since] Dispatch kick failed:", err);
      })
    );
  }

  return NextResponse.json({
    since,
    workflowsFound: failedWorkflows?.length ?? 0,
    workflowsRetried,
    scoresFound: failedScores?.length ?? 0,
    scoresRetried,
    scoreErrors,
  });
}
