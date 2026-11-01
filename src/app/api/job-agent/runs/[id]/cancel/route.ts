import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import {
  getRunById,
  requestRunCancellation,
  transitionRunStatus,
} from "@/server/repositories/jobAgentRunRepository";
import { abortApifyRun, getApifyRunDetails } from "@/server/services/jobAgentService";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";

export const dynamic = "force-dynamic";

function conflict(message: string, status = 409) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const run = await getRunById(params.id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.batch_id || run.trigger_type !== "manual") {
      return conflict("Only a manually started Job Agent run can be stopped here.", 403);
    }
    if (run.status === "pending") {
      const cancelled = await transitionRunStatus(run.id, "pending", {
        status: "cancelled",
        cancellation_kind: "operator",
        cancel_requested_at: new Date().toISOString(),
        cancel_reason: "Cancelled by operator before the Apify actor started.",
        error: "Cancelled by operator before the Apify actor started.",
        completed_at: new Date().toISOString(),
      });
      return cancelled
        ? NextResponse.json({ ok: true, status: "cancelled" })
        : conflict("The run changed while cancellation was being requested.");
    }
    if (run.status !== "running") return conflict(`Run is ${run.status} and cannot be stopped.`);
    if (!run.apify_run_id || !run.token_id) {
      return conflict("Apify is still accepting the start request. Wait a moment and try again.", 425);
    }
    if (run.cancellation_kind === "timeout") {
      return NextResponse.json({ ok: true, status: "cancellation_requested", reason: "The automatic time-limit stop is already in progress." }, { status: 202 });
    }

    const token = await getTokenById(run.token_id);
    if (!token) return conflict("The Apify credential for this run is no longer available.", 424);

    if (!run.cancel_requested_at) {
      const requested = await requestRunCancellation(run.id, "operator", "Operator requested immediate Apify cancellation.");
      if (!requested) {
        const latest = await getRunById(run.id);
        if (latest?.cancellation_kind === "timeout") {
          return NextResponse.json({ ok: true, status: "cancellation_requested", reason: "The automatic time-limit stop is already in progress." }, { status: 202 });
        }
        if (latest?.status !== "running") return conflict(`Run is ${latest?.status ?? "no longer active"} and cannot be stopped.`);
      }
    }

    const current = await getApifyRunDetails(run.apify_run_id, token);
    if (current.status === "SUCCEEDED") {
      return conflict("Apify already completed this run; the poller will process its dataset.");
    }
    if (current.status === "ABORTED") {
      const now = new Date().toISOString();
      const cancelled = await transitionRunStatus(run.id, "running", {
        status: "cancelled",
        cancellation_kind: "operator",
        cancel_requested_at: run.cancel_requested_at ?? now,
        cancel_reason: "Cancelled by operator.",
        error: "Cancelled by operator.",
        completed_at: now,
      });
      return cancelled ? NextResponse.json({ ok: true, status: "cancelled" }) : conflict("The run changed while cancellation was being confirmed.");
    }
    if (["FAILED", "TIMED-OUT"].includes(current.status)) {
      return conflict(`Apify already ended this run with status ${current.status}; refresh the run history.`);
    }

    const aborted = await abortApifyRun(run.apify_run_id, token);
    if (aborted.status === "SUCCEEDED") {
      return conflict("The actor finished before Apify could stop it; the poller will process its dataset.");
    }
    if (["FAILED", "TIMED-OUT"].includes(aborted.status)) {
      return conflict(`Apify ended the run with status ${aborted.status}; refresh the run history.`);
    }

    const now = new Date().toISOString();
    if (aborted.status === "ABORTED") {
      const cancelled = await transitionRunStatus(run.id, "running", {
        status: "cancelled",
        cancellation_kind: "operator",
        cancel_requested_at: now,
        cancel_reason: "Cancelled by operator.",
        error: "Cancelled by operator.",
        completed_at: now,
      });
      if (cancelled) return NextResponse.json({ ok: true, status: "cancelled" });
      return conflict("The run changed while Apify was stopping it. Refresh the run history.");
    }

    return NextResponse.json({ ok: true, status: "cancellation_requested", apifyStatus: aborted.status }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[job-agent/cancel] Could not cancel Apify run ${params.id}:`, error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
