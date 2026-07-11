// POST /api/application-ai-workflows/[id]/review — approve or reject after human review
// Requires APPLICATION_WORKER_ROLES

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { findWorkflowById } from "@/server/repositories/applicationAiWorkflowRepository";
import { processWorkflowStage } from "@/server/services/applicationAiWorkflowService";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const workflowId = params.id;
  const wf = await findWorkflowById(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  if (wf.status !== "waiting") {
    return NextResponse.json({
      error: `Workflow is not waiting for review (current status: ${wf.status})`,
    }, { status: 400 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const action: "approve" | "reject" | "reject_and_restart" = body.action;
  if (!["approve", "reject", "reject_and_restart"].includes(action)) {
    return NextResponse.json({
      error: "action must be 'approve', 'reject', or 'reject_and_restart'",
    }, { status: 400 });
  }

  const reviewerNote = body.note || null;
  const reviewerId = context?.profile.user_id;

  switch (action) {
    case "approve": {
      // Advance to Final Polish stage (stage 3 = Hiring Panel was completed, now run stage 4)
      await query(
        "UPDATE application_ai_workflows SET status = 'queued', current_stage = $1, last_error = NULL WHERE id = $2",
        [3, workflowId]
      );
      await query(
        "UPDATE applications SET resume_generation_status = 'resume_review', resume_generation_error = NULL WHERE id = $1",
        [wf.application_id]
      );

      // Log the approval decision
      await query(
        `INSERT INTO application_ai_artifacts (workflow_id, automation_id, sequence_number, schema_version, content_hash, data)
         VALUES ($1, 'human_review', 3, 'HumanReviewV1', $2, $3)`,
        [workflowId, `review_${Date.now()}`, JSON.stringify({ action: "approve", note: reviewerNote, reviewerId, timestamp: new Date().toISOString() })]
      );

      // Dispatch Final Polish
      processWorkflowStage(workflowId).catch((err) => {
        console.error(`[Workflow ${workflowId}] Review approval dispatch failed:`, err);
      });

      return NextResponse.json({
        workflowId,
        status: "approved",
        message: "Review approved. Final Polish will now run.",
      });
    }

    case "reject": {
      // Mark as failed, keep artifacts for reference
      await query(
        "UPDATE application_ai_workflows SET status = 'failed', last_error = $1 WHERE id = $2",
        [`Rejected by reviewer: ${reviewerNote || "No reason provided"}`, workflowId]
      );
      await query(
        "UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
        [`Rejected: ${reviewerNote || "No reason"}`, wf.application_id]
      );

      await query(
        `INSERT INTO application_ai_artifacts (workflow_id, automation_id, sequence_number, schema_version, content_hash, data)
         VALUES ($1, 'human_review', 3, 'HumanReviewV1', $2, $3)`,
        [workflowId, `review_${Date.now()}`, JSON.stringify({ action: "reject", note: reviewerNote, reviewerId, timestamp: new Date().toISOString() })]
      );

      return NextResponse.json({ workflowId, status: "failed", message: "Workflow rejected." });
    }

    case "reject_and_restart": {
      await query(
        "UPDATE application_ai_workflows SET status = 'queued', current_stage = 0, last_error = $1 WHERE id = $2",
        [`Rejected, restarting from stage 1: ${reviewerNote || ""}`, workflowId]
      );
      await query(
        "UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1",
        [wf.application_id]
      );

      await query(
        `INSERT INTO application_ai_artifacts (workflow_id, automation_id, sequence_number, schema_version, content_hash, data)
         VALUES ($1, 'human_review', 3, 'HumanReviewV1', $2, $3)`,
        [workflowId, `review_${Date.now()}`, JSON.stringify({ action: "reject_and_restart", note: reviewerNote, reviewerId, timestamp: new Date().toISOString() })]
      );

      processWorkflowStage(workflowId).catch((err) => {
        console.error(`[Workflow ${workflowId}] Restart dispatch failed:`, err);
      });

      return NextResponse.json({ workflowId, status: "restarting", message: "Restarting from stage 1." });
    }
  }
}
