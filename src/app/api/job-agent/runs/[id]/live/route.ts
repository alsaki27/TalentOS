import { NextRequest, NextResponse } from "next/server";
import {
  getRunById,
  updateRunStatus,
} from "@/server/repositories/jobAgentRunRepository";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";
import {
  fetchLiveApifyDatasetItems,
  checkApifyRunStatus,
  processApifyRunData,
} from "@/server/services/jobAgentService";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-memory guard so we never fire two processing calls for the same run
// concurrently (Next.js dev mode restarts the process, so this is safe).
const processingSet = new Set<string>();

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // auth guard — requireCurrentUser returns { context, response }
    const auth = await requireCurrentUser();
    if (auth.response) return auth.response;

    const run = await getRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // The run was created but we don't yet have Apify metadata.
    if (!run.apify_run_id || !run.apify_dataset_id || !run.token_id) {
      return NextResponse.json({
        items: [],
        status: run.status,
        apify_status: null,
      });
    }

    const token = await getTokenById(run.token_id);
    if (!token) {
      return NextResponse.json({ error: "Token not found" }, { status: 500 });
    }

    // ── 1. Check Apify status ───────────────────────────────────────────
    let apifyStatus: string | null = null;

    if (run.status === "running" || run.status === "pending") {
      try {
        apifyStatus = await checkApifyRunStatus(run.apify_run_id, token);
      } catch (err: any) {
        console.error(
          `[live] status check for run ${params.id} failed:`,
          err.message
        );
        // If we can't reach Apify, keep showing whatever items we have.
        return NextResponse.json({
          items: [],
          status: run.status,
          error: `Apify unreachable: ${err.message}`,
        });
      }
    }

    // ── 2. Auto-complete when Apify finishes ────────────────────────────
    if (apifyStatus === "SUCCEEDED") {
      // Guard against concurrent processing – only one caller should
      // kick off processApifyRunData, but multiple poll cycles may
      // see SUCCEEDED before the first one has written "processing".
      if (!processingSet.has(params.id)) {
        processingSet.add(params.id);

        // Mark the run as "processing" so the UI shows the right status
        // while the data is being downloaded, classified, and inserted.
        await updateRunStatus(params.id, { status: "processing" }).catch(() => {});

        // Fire-and-forget so this poll returns quickly.
        processApifyRunData(params.id, run.apify_dataset_id!, token, {
          useAi: true,
        })
          .then(() => processingSet.delete(params.id))
          .catch((err) => {
            console.error(
              `[live] processApifyRunData for ${params.id} failed:`,
              err
            );
            processingSet.delete(params.id);
            // Mark the run as failed so the UI doesn't spin forever.
            updateRunStatus(params.id, {
              status: "failed",
              error: err.message ?? "Processing failed",
            }).catch(() => {});
          });

        return NextResponse.json({
          items: [],
          status: "processing",
          apify_status: apifyStatus,
        });
      }

      // Another poll cycle already triggered processing; just report
      // the current state.
      return NextResponse.json({
        items: [],
        status: "processing",
        apify_status: apifyStatus,
      });
    }

    if (apifyStatus && ["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
      await updateRunStatus(params.id, {
        status: "failed",
        error: `Apify run ended with status ${apifyStatus}`,
      }).catch(() => {});
      return NextResponse.json({
        items: [],
        status: "failed",
        apify_status: apifyStatus,
      });
    }

    // ── 3. Fetch live dataset items ─────────────────────────────────────
    let items: any[] = [];
    try {
      items = await fetchLiveApifyDatasetItems(
        run.apify_dataset_id,
        token,
        100
      );
    } catch (err: any) {
      console.error(`[live] dataset fetch for ${params.id} failed:`, err.message);
      // Non-fatal — return whatever status we have.
    }

    // ── 4. Re-read run for post-processing status ───────────────────────
    const updatedRun = await getRunById(params.id);

    return NextResponse.json({
      status: updatedRun?.status ?? run.status,
      items: items.map((item) => ({
        title: item.job_title ?? item.title ?? "Unknown Role",
        company: item.company_name ?? item.company ?? "Unknown Company",
        location: item.location ?? "Remote / Unknown",
        salary: item.salary_range ?? item.salary ?? "",
        date: item.date_posted ?? item.posted_at ?? "",
      })),
      apify_status: apifyStatus,
    });
  } catch (err: any) {
    console.error("[live feed error]", err);
    return NextResponse.json(
      { error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
