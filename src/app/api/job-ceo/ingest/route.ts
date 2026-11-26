import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { insertStaged, checkAndRecordDedup, computeJobDedupSignature, stageDeferredJobs } from "@/server/repositories/jobCeoStagingRepository";
import { createRun, findRunById, bumpRunCounts } from "@/server/repositories/jobCeoRunRepository";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Fails closed: missing secret = always reject.
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { runId?: unknown; deferDispatch?: unknown; jobs?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobs = body.jobs ?? [];
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json({ error: "jobs array is required and must not be empty" }, { status: 400 });
  }
  if (body.deferDispatch !== undefined && typeof body.deferDispatch !== "boolean") {
    return NextResponse.json({ error: "deferDispatch must be a boolean" }, { status: 400 });
  }
  const deferDispatch = body.deferDispatch === true;
  if (deferDispatch && body.runId !== undefined && (typeof body.runId !== "string" || !UUID_RE.test(body.runId))) {
    return NextResponse.json({ error: "deferred append batches require a valid runId" }, { status: 400 });
  }

  try {
    // Create run if not provided. This single endpoint is shared by every
    // scraper (OpenJobData, Actalent, Broadstaff, and any future one) —
    // "source" was previously hardcoded to "openjobdata" here regardless of
    // who actually called it, so the Job CEO run history showed every
    // Actalent/Broadstaff run mislabeled. Every caller already tags each
    // job's raw.source with its true origin (confirmed: openjobdata_ingest.py
    // sets raw.source: "openjobdata" the same way actalent_ingest.py sets
    // "actalentservices" and broadstaff_ingest.py sets "broadstaffglobal") —
    // one POST body is always one script's own batch, so every job in it
    // carries the same source, and reading it off the first job is exact,
    // not a guess. "openjobdata" remains the fallback only for a caller that
    // sets no raw.source at all, preserving today's behavior for that case.
    const runSource = jobs
      .map((j) => (j.raw && typeof j.raw === "object" ? (j.raw as Record<string, unknown>).source : undefined))
      .find((s): s is string => typeof s === "string" && s.trim().length > 0);
    const runSources = new Set(jobs
      .map((j) => (j.raw && typeof j.raw === "object" ? (j.raw as Record<string, unknown>).source : undefined))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().toLowerCase()));
    if (deferDispatch && runSources.size > 1) {
      return NextResponse.json({ error: "deferred staging batches must contain one source only" }, { status: 400 });
    }

    let runId = typeof body.runId === "string" ? body.runId : undefined;
    if (deferDispatch && runId) {
      const existingRun = await findRunById(runId);
      if (!existingRun) {
        return NextResponse.json({ error: "deferred staging run not found" }, { status: 404 });
      }
      if (existingRun.status !== "staging") {
        return NextResponse.json({ error: "deferred append requires a run that is still staging" }, { status: 409 });
      }
      if (runSource && existingRun.source && existingRun.source.toLowerCase() !== runSource.trim().toLowerCase()) {
        return NextResponse.json({ error: "deferred append source does not match the staging run" }, { status: 409 });
      }
      runId = existingRun.id;
    } else if (!runId && !deferDispatch) {
      const run = await createRun({
        triggerType: "cron",
        source: runSource ?? "openjobdata",
      });
      runId = run.id;
    }

    // Build dedup signatures for all incoming jobs. computeJobDedupSignature
    // is the same function insertStaged uses to populate dedup_signature on
    // the row — they must never diverge (see its docstring: a mismatch
    // breaks the release path used on QA-drop and run deletion). A job with
    // literally no title, company, or external_job_id gets a random,
    // never-repeating signature rather than colliding every such row into
    // one shared blank-key signature.
    const jobSignatures = jobs.map((j) => computeJobDedupSignature(j) ?? `empty:${randomUUID()}`);

    const signaturesInput = jobs.map((j, i) => ({
      signature: jobSignatures[i],
      title: String(j.title ?? ""),
      company: String(j.company ?? ""),
    }));

    let staged = 0;
    let skipped = 0;
    if (deferDispatch) {
      // Deferred uploads need row reservation, staging insert, and run counts
      // in one transaction. The repository also locks/rechecks the run row so
      // an explicit dispatcher cannot start ingesting between these steps.
      const result = await stageDeferredJobs(runId, jobs as any[], jobSignatures, runSource);
      if (!result) {
        return NextResponse.json({ error: "deferred staging run not found" }, { status: 404 });
      }
      if (result.status !== "staging" || !result.accepted) {
        const sourceMismatch = runSource && result.source && result.source.toLowerCase() !== runSource.trim().toLowerCase();
        return NextResponse.json({
          error: sourceMismatch
            ? "deferred append source does not match the staging run"
            : "deferred append requires a run that is still staging",
        }, { status: 409 });
      }
      runId = result.runId;
      staged = result.staged;
      skipped = result.skipped;
    } else {
      // Cross-run dedup: get only signatures not previously seen
      const newSignatures = await checkAndRecordDedup(runId!, signaturesInput);

      // Filter jobs to only the ones with new signatures
      const dedupedJobs = jobs.filter((_, i) => newSignatures.has(jobSignatures[i]));

      skipped = jobs.length - dedupedJobs.length;

      // Insert the de-duplicated jobs
      if (dedupedJobs.length > 0) {
        staged = await insertStaged(runId!, dedupedJobs as any[]);
        await bumpRunCounts(runId!, { ingested_count: staged, skipped_count: skipped });
      } else if (skipped > 0) {
        // Still bump skipped count even if nothing new
        await bumpRunCounts(runId!, { skipped_count: skipped });
      }
    }

    // Trigger dispatch if we actually staged new jobs
    if (staged > 0 && !deferDispatch) {
      // Use the same URL-resolution logic as jobCeoService.ts dispatchAndChain:
      // prefer TALENTOS_BASE_URL env var, fall back to localhost in dev, production in prod.
      const baseUrl =
        process.env.TALENTOS_BASE_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:3000"
          : "https://talent.skarion.com");
      const dispatchUrl = new URL(`${baseUrl}/api/job-ceo/dispatch`);
      // Adzuna's GitHub Action owns completion polling for its specific run.
      // Its initial kick must carry the same scope so it cannot consume an
      // unrelated source's older active run.
      if (runSource?.toLowerCase() === "adzuna") {
        dispatchUrl.searchParams.set("runId", runId);
      }
      const cronSecret = process.env.CRON_SECRET;
      await backgroundDispatch(
        fetch(dispatchUrl.toString(), {
          method: "POST",
          // Bug 2 fix: include auth header so dispatch route does not reject with 401.
          headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
        }).catch((err) => {
          console.error("[Job CEO] Ingest dispatch self-fetch failed:", err);
        })
      );
    }

    return NextResponse.json({
      runId,
      staged,
      skipped,
      total_received: jobs.length,
      dispatch_deferred: deferDispatch,
      message: skipped > 0
        ? `${staged} new jobs staged, ${skipped} duplicates skipped`
        : `${staged} jobs staged`,
    });
  } catch (err) {
    console.error("[Job CEO] Ingest error:", err);
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
