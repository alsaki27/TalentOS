// Finalization service — creates a proper application_resume_versions row
// linked explicitly to the workflow, target_job, application, job, and candidate.
// Verifies export readiness before persisting. Idempotent: calling twice returns
// the existing result.
//
// Atomicity boundary:
//   The CTE in this function atomically inserts the resume version AND updates
//   the application (tailored_resume_version_id + ai_workflow_id + status) in a
//   single round-trip. ON CONFLICT ensures concurrent finalizers both get the
//   same version ID. The subsequent workflow status update is idempotent (setting
//   status='completed' twice is safe). The packet upsert uses ON CONFLICT so it
//   is also safe to retry. The activity log is best-effort — failure there does
//   not roll back the core finalization.

import { updateWorkflowStatus, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export async function finalizeWorkflow(workflowId: string): Promise<string | null> {
  const artifacts = await listArtifacts(workflowId);

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

  const finalArtifact = artifacts.find((a) => a.automation_id === "application_final_polish");
  const draftArtifact = artifacts.find((a) => a.automation_id === "application_resume_forge");
  const finalData = finalArtifact?.data ?? draftArtifact?.data;

  if (!finalData) {
    await updateWorkflowStatus(workflowId, "failed", { last_error: "No final resume artifact found" });
    await query("UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
      ["No final resume artifact found", wf.application_id]);
    return null;
  }

  const exportReady = (finalData as any)?.exportReady ?? (finalData as any)?.ready ?? true;
  if (!exportReady) {
    await updateWorkflowStatus(workflowId, "failed", { last_error: "Final resume not marked as export-ready" });
    await query("UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
      ["Final resume not export-ready", wf.application_id]);
    return null;
  }

  const tj = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs
     WHERE candidate_id = $1 AND job_id = (SELECT job_id FROM applications WHERE id = $2)
     LIMIT 1`,
    [wf.candidate_id, wf.application_id]
  );
  if (!tj) throw new Error(`No target_job found for candidate ${wf.candidate_id}`);

  // Atomic INSERT + UPDATE via CTE: resume version AND application update succeed or fail together.
  // ON CONFLICT handles concurrent finalizers — both get the same version ID.
  const title = "AI-Generated Tailored Resume";
  const contentJson = JSON.stringify(finalData);
  const versionRows = await query<{ id: string }>(
    `WITH inserted AS (
       INSERT INTO application_resume_versions
         (candidate_id, target_job_id, application_id, job_id, workflow_id, base_resume_id,
          title, content, source_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai_agent', 'draft', NOW())
       ON CONFLICT (workflow_id) WHERE source_type = 'ai_agent'
       DO UPDATE SET updated_at = NOW()
       RETURNING id
     )
     UPDATE applications SET
       tailored_resume_version_id = inserted.id,
       ai_workflow_id = $9,
       resume_generation_status = 'ready',
       resume_generation_completed_at = NOW()
     FROM inserted
     WHERE applications.id = $10
     RETURNING inserted.id`,
    [
      wf.candidate_id, tj.id, wf.application_id, wf.job_id, workflowId, wf.base_resume_id,
      title, contentJson, workflowId, wf.application_id,
    ]
  );
  const versionId = versionRows[0]?.id;
  if (!versionId) throw new Error("Failed to insert resume version — no ID returned");

  // Mark workflow completed
  await updateWorkflowStatus(workflowId, "completed");

  // Upsert application packet — separate try/catch so packet failure
  // does not roll back the core finalization.
  try {
    await query(
      `INSERT INTO application_packets (application_id, base_resume_id, target_job_id, final_resume_version_id, created_by)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (application_id) DO UPDATE SET
         final_resume_version_id = EXCLUDED.final_resume_version_id,
         base_resume_id = COALESCE(application_packets.base_resume_id, EXCLUDED.base_resume_id),
         target_job_id = COALESCE(application_packets.target_job_id, EXCLUDED.target_job_id)`,
      [wf.application_id, wf.base_resume_id, tj.id, versionId]
    );
  } catch (err: any) {
    console.error("[finalizeWorkflow] Failed to upsert application_packet:", err.message || err);
  }

  // Log activity (non-critical — failure here does not roll back)
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
