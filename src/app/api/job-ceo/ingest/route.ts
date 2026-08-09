import { NextRequest, NextResponse } from "next/server";
import { insertStaged, checkAndRecordDedup } from "@/server/repositories/jobCeoStagingRepository";
import { createRun, bumpRunCounts } from "@/server/repositories/jobCeoRunRepository";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Fails closed: missing secret = always reject.
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { runId?: string; jobs?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobs = body.jobs ?? [];
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json({ error: "jobs array is required and must not be empty" }, { status: 400 });
  }

  try {
    // Create run if not provided
    let runId = body.runId;
    if (!runId) {
      const run = await createRun({ triggerType: "cron", source: "openjobdata" });
      runId = run.id;
    }

    // Build dedup signatures for all incoming jobs
    const signaturesInput = jobs.map((j) => {
      const title = (String(j.title ?? "")).toLowerCase().trim();
      const company = (String(j.company ?? "")).toLowerCase().trim();
      return {
        signature: `${title}|${company}`,
        title: String(j.title ?? ""),
        company: String(j.company ?? ""),
      };
    });

    // Cross-run dedup: get only signatures not previously seen
    const newSignatures = await checkAndRecordDedup(runId, signaturesInput);

    // Filter jobs to only the ones with new signatures
    const dedupedJobs = jobs.filter((j) => {
      const title = (String(j.title ?? "")).toLowerCase().trim();
      const company = (String(j.company ?? "")).toLowerCase().trim();
      const sig = `${title}|${company}`;
      return newSignatures.has(sig);
    });

    const skipped = jobs.length - dedupedJobs.length;

    // Insert the de-duplicated jobs
    let staged = 0;
    if (dedupedJobs.length > 0) {
      staged = await insertStaged(runId, dedupedJobs as any[]);
      await bumpRunCounts(runId, { ingested_count: staged, skipped_count: skipped });
    } else {
      // Still bump skipped count even if nothing new
      if (skipped > 0) {
        await bumpRunCounts(runId, { skipped_count: skipped });
      }
    }

    // Trigger dispatch if we actually staged new jobs
    if (staged > 0) {
      // Use the same URL-resolution logic as jobCeoService.ts dispatchAndChain:
      // prefer TALENTOS_BASE_URL env var, fall back to localhost in dev, production in prod.
      const baseUrl =
        process.env.TALENTOS_BASE_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:3000"
          : "https://talent.skarion.com");
      const cronSecret = process.env.CRON_SECRET;
      await backgroundDispatch(
        fetch(`${baseUrl}/api/job-ceo/dispatch`, {
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
      message: skipped > 0
        ? `${staged} new jobs staged, ${skipped} duplicates skipped`
        : `${staged} jobs staged`,
    });
  } catch (err) {
    console.error("[Job CEO] Ingest error:", err);
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
