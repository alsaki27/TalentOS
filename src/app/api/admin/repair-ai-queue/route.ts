import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { retryWorkflow } from "@/server/services/applicationAiWorkflowService";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { getWorkflowDispatchHeaders } from "@/server/lib/dispatchAuth";

export const dynamic = "force-dynamic";

/**
 * Requeue only terminal AI workflows. Queued/running rows are deliberately
 * left alone: the normal dispatcher owns those states and already reclaims
 * expired leases. Retrying a queued row here would create duplicate claims
 * and amplify provider rate limits.
 */
async function repairQueue(req: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  const since = url.searchParams.get("since") ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const workflows = await query<{ id: string }>(
    `SELECT id
       FROM application_ai_workflows
      WHERE status IN ('failed', 'cancelled')
        AND created_at >= $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [since, limit],
  );

  const errors: { workflowId: string; message: string }[] = [];
  let retried = 0;
  for (const workflow of workflows) {
    try {
      await retryWorkflow(workflow.id);
      retried += 1;
    } catch (error: any) {
      errors.push({ workflowId: workflow.id, message: error?.message ?? String(error) });
    }
  }

  if (retried > 0) {
    const baseUrl = process.env.TALENTOS_BASE_URL || "https://talent.skarion.com";
    await backgroundDispatch(
      fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
        method: "POST",
        headers: getWorkflowDispatchHeaders(),
      }).catch((error) => {
        console.error("[repair-ai-queue] Dispatcher kick failed:", error);
      }),
    );
  }

  return NextResponse.json({
    since,
    found: workflows.length,
    retried,
    errors,
    note: "Queued and running workflows were left for the normal lease-aware dispatcher.",
  });
}

export async function POST(req: NextRequest) {
  return repairQueue(req);
}

// This is intentionally opt-in and admin-gated so the authenticated control
// center can execute the repair when a direct POST client is unavailable.
// Without execute=1 it remains read-only rather than mutating on navigation.
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get("execute") !== "1") {
    return NextResponse.json({ error: "Use POST, or GET with execute=1 from the authenticated admin control center." }, { status: 405 });
  }
  return repairQueue(req);
}
