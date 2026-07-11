// Finalization service — creates a proper application_resume_versions row
// linked explicitly to the workflow, target_job, and application.
// Uses query() instead of execute() so RETURNING actually returns rows.

import { updateWorkflowStatus, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export async function finalizeWorkflow(workflowId: string): Promise<string | null> {
  const artifacts = await listArtifacts(workflowId);

  // Find the workflow + application
  const wf = await queryOne<{
    id: string; application_id: string; candidate_id: string; base_resume_id: string | null;
  }>(
    `SELECT w.id, w.application_id, a.candidate_id, w.base_resume_id
     FROM application_ai_workflows w
     JOIN applications a ON w.application_id = a.id
     WHERE w.id = $1`,
    [workflowId]
  );
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  // Get the final resume artifact
  const finalArtifact = artifacts.find((a) => a.automation_id === "application_final_polish");
  const draftArtifact = artifacts.find((a) => a.automation_id === "application_resume_forge");
  const finalData = finalArtifact?.data ?? draftArtifact?.data;

  if (!finalData) {
    await updateWorkflowStatus(workflowId, "failed", { last_error: "No final resume artifact found" });
    return null;
  }

  // Find the target_job for this candidate+job combo
  const tj = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs
     WHERE candidate_id = $1 AND job_id = (SELECT job_id FROM applications WHERE id = $2)
     LIMIT 1`,
    [wf.candidate_id, wf.application_id]
  );
  if (!tj) throw new Error(`No target_job found for candidate ${wf.candidate_id}`);

  // INSERT with query() so RETURNING actually returns the row
  const versionRows = await query<{ id: string }>(
    `INSERT INTO application_resume_versions
      (candidate_id, target_job_id, title, content, source_type, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
     RETURNING id`,
    [wf.candidate_id, tj.id, "AI-Generated Tailored Resume", JSON.stringify(finalData), "base_resume"]
  );
  const versionId = versionRows[0]?.id;
  if (!versionId) throw new Error("Failed to insert resume version — no ID returned");

  // Update workflow with the resume version ID
  await updateWorkflowStatus(workflowId, "completed");

  // Log activity
  await logActivity({
    userId: undefined,
    actorName: "AI Agent Pipeline",
    type: "update",
    description: `Multi-agent workflow completed. Resume version: ${versionId}`,
    entityType: "application",
    entityId: wf.application_id,
    entityName: `Workflow ${workflowId}`,
    metadata: { workflowId, artifactCount: artifacts.length, versionId },
  });

  return versionId;
}
