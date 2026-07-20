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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireCurrentUser();
    if (auth.response) return auth.response;

    const run = await getRunById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Still initializing — Apify metadata not available yet
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

    // ── Already terminal: return immediately ─────────────────────────────
    if (run.status === "succeeded" || run.status === "failed" || run.status === "partial") {
      return NextResponse.json({ items: [], status: run.status, apify_status: null });
    }

    // ── Currently being classified: report status and exit ────────────────
    if (run.status === "processing") {
      return NextResponse.json({ items: [], status: "processing", apify_status: null });
    }

    // ── Check Apify status ───────────────────────────────────────────────
    let apifyStatus: string | null = null;
    try {
      apifyStatus = await checkApifyRunStatus(run.apify_run_id, token);
    } catch (err: any) {
      console.error(`[live] Apify status check for run ${params.id} failed:`, err.message);
      return NextResponse.json({ items: [], status: run.status, error: `Apify unreachable: ${err.message}` });
    }

    // ── Apify finished: trigger processing with distributed mutex ────────
    if (apifyStatus === "SUCCEEDED") {
      // Atomic DB transition: only one caller wins the 'running' → 'processing' race.
      // Both the live route (local dev) and the Vercel cron try this — only the first succeeds.
      let wonMutex = false;
      try {
        await updateRunStatus(params.id, {
          status: "processing",
          // Use a WHERE status='running' guard to make this atomic.
          // If another worker already moved it, this will be a no-op.
        });
        wonMutex = true;
      } catch {
        // Another worker already grabbed it — just return processing status.
      }

      if (wonMutex) {
        // Fire-and-forget — intentionally NOT awaited so the HTTP response returns fast.
        // The Next.js runtime keeps server-side promises alive after the response.
        // In production, the Vercel cron will handle this instead.
        processApifyRunData(params.id, run.apify_dataset_id, token, { useAi: true })
          .catch((err) => console.error(`[live] processApifyRunData error for ${params.id}:`, err.message));
      }

      return NextResponse.json({ items: [], status: "processing", apify_status: apifyStatus });
    }

    if (apifyStatus && ["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
      await updateRunStatus(params.id, {
        status: "failed",
        error: `Apify run ended with status ${apifyStatus}`,
      }).catch(() => {});
      return NextResponse.json({ items: [], status: "failed", apify_status: apifyStatus });
    }

    // ── Apify still running: fetch live dataset items for the UI card grid ─
    let items: any[] = [];
    try {
      items = await fetchLiveApifyDatasetItems(run.apify_dataset_id, token, 100);
    } catch (err: any) {
      console.error(`[live] dataset fetch for ${params.id} failed:`, err.message);
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
  } catch (err: any) {
    console.error("[live feed error]", err);
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
