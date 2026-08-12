import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { regenerateAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";
import { findActiveWorkflowByApplicationId } from "@/server/repositories/applicationAiWorkflowRepository";

export const dynamic = "force-dynamic";

// Restarts the full AI tailoring pipeline for an application that already has
// a generated resume - a fresh run from JobLens through Final Polish, not a
// continuation of the existing one. See regenerateAiWorkflowForApplication
// for why this is a distinct entry point from the plain Generate/Retry route.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  if (!applicationId) {
    return NextResponse.json({ error: "Application ID is required" }, { status: 400 });
  }

  let result;
  try {
    result = await regenerateAiWorkflowForApplication(applicationId, context?.profile.user_id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }

  if (!result.started) {
    if (result.reason === "An active workflow already exists for this application") {
      const existing = await findActiveWorkflowByApplicationId(applicationId);
      return NextResponse.json({
        error: result.reason,
        workflowId: existing?.id,
        status: existing?.status,
      }, { status: 409 });
    }
    if (result.reason === "Application not found") {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    if (result.reason === "No base resume found for this candidate yet") {
      return NextResponse.json({
        error: "No base resume found. Please select or create a base resume for this candidate before regenerating.",
      }, { status: 400 });
    }
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({
    workflowId: result.workflowId,
    status: "queued",
    message: "Resume regeneration started — running the full pipeline from scratch.",
  }, { status: 202 });
}
