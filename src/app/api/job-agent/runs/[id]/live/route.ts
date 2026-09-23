import { NextRequest, NextResponse } from "next/server";
import {
  getRunById,
  transitionRunStatus,
} from "@/server/repositories/jobAgentRunRepository";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";
import {
  fetchLiveApifyDatasetItems,
  checkApifyRunStatus,
  processApifyRunData,
} from "@/server/services/jobAgentService";
import { requireCurrentUser } from "@/lib/auth";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireCurrentUser();
    if (auth.response) return auth.response;

    const run = await getRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!run.apify_run_id || !run.apify_dataset_id || !run.token_id) {
      return NextResponse.json({ items: [], status: run.status, apify_status: null });
    }

    const token = await getTokenById(run.token_id);
    if (!token) {
      return NextResponse.json({ error: "Token not found" }, { status: 500 });
    }

    if (run.status === "succeeded" || run.status === "failed" || run.status === "partial") {
      return NextResponse.json({ items: [], status: run.status, apify_status: null });
    }
    if (run.status === "processing") {
      return NextResponse.json({ items: [], status: "processing", apify_status: null });
    }

    let apifyStatus: string | null = null;
    try {
      apifyStatus = await checkApifyRunStatus(run.apify_run_id, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[live] Apify status check for run ${params.id} failed:`, message);
      return NextResponse.json({
        items: [],
        status: run.status,
        error: `Apify unreachable: ${message}`,
      });
    }

    if (apifyStatus === "SUCCEEDED") {
      // Nightly attempts are owned by the cron poller, which also coordinates
      // shard state and applies the batch's immutable posting-date window.
      if (run.batch_id) {
        return NextResponse.json({ items: [], status: run.status, apify_status: apifyStatus });
      }

      // Manual runs retain live-route processing. The compare-and-set means the
      // live route and cron poller cannot process the same dataset twice.
      const wonMutex = await transitionRunStatus(params.id, "running", {
        status: "processing",
        processing_started_at: new Date().toISOString(),
      });

      if (wonMutex) {
        waitUntil(
          processApifyRunData(params.id, run.apify_dataset_id, token, {
            useAi: true,
            actorSource: run.actor_source as any,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[live] processApifyRunData error for ${params.id}:`, message);
          })
        );
      }

      return NextResponse.json({ items: [], status: "processing", apify_status: apifyStatus });
    }

    if (apifyStatus && ["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
      // Batch failure/retry state is likewise coordinated only by the poller.
      if (run.batch_id) {
        return NextResponse.json({ items: [], status: run.status, apify_status: apifyStatus });
      }
      await transitionRunStatus(params.id, "running", {
        status: "failed",
        error: `Apify run ended with status ${apifyStatus}`,
        completed_at: new Date().toISOString(),
      }).catch(() => false);
      return NextResponse.json({ items: [], status: "failed", apify_status: apifyStatus });
    }

    let items: any[] = [];
    try {
      items = await fetchLiveApifyDatasetItems(run.apify_dataset_id, token, 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[live] dataset fetch for ${params.id} failed:`, message);
    }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[live feed error]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
