// Finalization service — creates a proper application_resume_versions row
// linked explicitly to the workflow, target_job, application, job, and candidate.
// Uses query() instead of execute() so RETURNING actually returns rows.
// Updates applications table with result fields for direct queue lookup.

import { updateWorkflowStatus, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export async function finalizeWorkflow(workflowId: string): Promise<string | null> {
  const artifacts = await listArtifacts(workflowId);

  // Find the workflow + application + job
  const wf = await queryOne<{
    id: string; application_id: string; candidate_id: string; job_id: string | null; base_resume_id: string | null;
  }>(
    `SELECT w.id, w.application_id, a.candidate_id, a.job_id, w.base_resume_id
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
    // Update application status
    await query("UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
      ["No final resume artifact found", wf.application_id]);
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
      (candidate_id, target_job_id, application_id, job_id, workflow_id, base_resume_id,
       title, content, source_type, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai_agent', 'draft', NOW())
     RETURNING id`,
    [
      wf.candidate_id, tj.id, wf.application_id, wf.job_id, workflowId, wf.base_resume_id,
      "AI-Generated Tailored Resume", JSON.stringify(finalData),
    ]
  );
  const versionId = versionRows[0]?.id;
  if (!versionId) throw new Error("Failed to insert resume version — no ID returned");

  // Update application with result fields (direct lookup, no lateral joins needed)
  await query(
    `UPDATE applications SET
       tailored_resume_version_id = $1,
       ai_workflow_id = $2,
       resume_generation_status = 'ready',
       resume_generation_completed_at = NOW()
     WHERE id = $3`,
    [versionId, workflowId, wf.application_id]
  );

  // Mark workflow completed
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
    metadata: { workflowId, versionId, artifactCount: artifacts.length },
  });

  return versionId;
}
