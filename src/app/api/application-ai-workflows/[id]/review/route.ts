import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { getAiRuntimeConfig, resumePipelineSettings } from "@/server/repositories/aiRuntimeConfigRepository";
import { manualResumeTransition } from "@/server/repositories/resumeWorkflowRecoveryRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => null);
  const { action, note } = body ?? {};
  if (action !== "approve" && action !== "reject" && action !== "reject_and_restart") {
    return NextResponse.json({ error: "Invalid review action" }, { status: 400 });
  }
  const settings = resumePipelineSettings(await getAiRuntimeConfig());
  const changed = await manualResumeTransition({
    id: params.id, stage: null, action,
    note: typeof note === "string" ? note.trim().slice(0, 2000) : null,
    reviewerId: context?.profile.user_id,
    staleHeartbeatSeconds: settings.staleHeartbeatSeconds,
  });
  if (!changed) {
    return NextResponse.json({ error: "A recorded review gate and successful Hiring Panel output are required" }, { status: 409 });
  }
  return NextResponse.json({
    workflowId: params.id,
    status: action === "approve" ? "approved" : action === "reject_and_restart" ? "restarting" : changed.status,
  });
}
