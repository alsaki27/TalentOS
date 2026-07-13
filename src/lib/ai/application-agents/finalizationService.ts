// Finalization service — creates a proper application_resume_versions row
// linked explicitly to the workflow, target_job, application, job, and candidate.
// Verifies export readiness before persisting. Idempotent: calling twice returns
// the existing result.
//
// Atomicity boundary:
//   The CTE+workflow update+packet upsert run inside a single Neon
//   sql.transaction(). If any query fails, the entire transaction rolls back,
//   preventing partial finalization (a stale workflow marked completed without
//   a version row, or a version row without a packet). The activity log is
//   best-effort — failure there does not roll back the core finalization.

import { updateWorkflowStatus, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne, sql as getSql } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { finalResumeToStudioDocument } from "./finalResumeToStudioDocument";
import type { FinalResumeV1, ReviewScoreV1 } from "./schemas";

export async function finalizeWorkflow(workflowId: string): Promise<string | null> {
  const artifacts = await listArtifacts(workflowId);

  const wf = await queryOne<{
    id: string; application_id: string; candidate_id: string; job_id: string | null; base_resume_id: string | null;
    config_snapshot: any;
  }>(
    `SELECT w.id, w.application_id, w.base_resume_id, w.config_snapshot,
            a.candidate_id, a.job_id
     FROM application_ai_workflows w
     JOIN applications a ON w.application_id = a.id
     WHERE w.id = $1`,
    [workflowId]
  );
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  const finalArtifact = artifacts.find((a) => a.automation_id === "application_final_polish");
  const finalData = finalArtifact?.data as FinalResumeV1 | undefined;

  if (!finalData) {
    const errMsg = "No Final Polish artifact found — pipeline incomplete.";
    await updateWorkflowStatus(workflowId, "failed", { last_error: errMsg });
    await query("UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
      [errMsg, wf.application_id]);
    return null;
  }


  // ATS score comes from the Hiring Panel review (ReviewScoreV1.atsScore, 0-10),
  // not the Final Polish QA score — that's the recruiter/HR/ATS-blend the studio
  // and queue surface to the applicant worker. Fall back to finalQaScore only
  // if the review artifact is somehow missing.
  const reviewArtifact = artifacts.find((a) => a.automation_id === "application_hiring_panel");
  const reviewData = reviewArtifact?.data as ReviewScoreV1 | undefined;
  const atsScore =
    typeof reviewData?.atsScore === "number" ? reviewData.atsScore
    : typeof (finalData as any).finalQaScore === "number" ? (finalData as any).finalQaScore
    : null;
  const truthScore =
    typeof reviewData?.truthfulnessRisk === "number" ? reviewData.truthfulnessRisk : null;

  // The agent schema (FinalResumeV1) carries no contact/identity data; the
  // studio's ResumeDocument shape needs the candidate's header, which lives on
  // the base resume content. Prefer the freshest base_resumes.content via
  // base_resume_id, falling back to the immutable workflow snapshot.
  let baseContent: any = null;
  if (wf.base_resume_id) {
    const baseRow = await queryOne<{ content: any }>(
      "SELECT content FROM base_resumes WHERE id = $1",
      [wf.base_resume_id]
    );
    baseContent = baseRow?.content ?? null;
  }
  if (!baseContent) {
    baseContent = (wf.config_snapshot?.baseResume as any)?.content ?? null;
  }

  const studioDocument = finalResumeToStudioDocument(finalData, baseContent);

  const tj = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs
     WHERE candidate_id = $1 AND job_id = (SELECT job_id FROM applications WHERE id = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [wf.candidate_id, wf.application_id]
  );
  if (!tj) throw new Error(`No target_job found for candidate ${wf.candidate_id}`);

  // ATOMICITY BOUNDARY (critical path): all three operations run inside a single
  // database transaction via Neon's sql.transaction(). If any query fails, the
  // entire transaction rolls back, preventing partial finalization.
  const title = "AI-Generated Tailored Resume";
  // Store the studio-native ResumeDocument (not the raw FinalResumeV1) so the
  // Falood Application Resume Studio renders it directly without a runtime
  // adapter, and persist the ATS/truth scores so the studio + queue can show
  // them.
  const contentJson = JSON.stringify(studioDocument);
  const dbSql = getSql();
  let versionId: string | null = null;
  try {
    const [versionRows] = await dbSql.transaction([
      dbSql`WITH inserted AS (
         INSERT INTO application_resume_versions
           (candidate_id, target_job_id, application_id, job_id, workflow_id, base_resume_id,
            title, content, source_type, status, ats_score, truth_score, created_at)
         VALUES (${wf.candidate_id}, ${tj.id}, ${wf.application_id}, ${wf.job_id ?? null}, ${workflowId}, ${wf.base_resume_id ?? null},
                 ${title}, ${contentJson}, 'ai_agent', 'draft', ${atsScore}, ${truthScore}, NOW())
         ON CONFLICT (workflow_id) WHERE source_type = 'ai_agent'
         DO UPDATE SET content = EXCLUDED.content, ats_score = EXCLUDED.ats_score,
                       truth_score = EXCLUDED.truth_score, updated_at = NOW()
         RETURNING id
       )
       UPDATE applications SET
         tailored_resume_version_id = inserted.id,
         ai_workflow_id = ${workflowId},
         resume_generation_status = 'ready',
         resume_generation_completed_at = NOW()
       FROM inserted
       WHERE applications.id = ${wf.application_id}
       RETURNING inserted.id`,

      dbSql`UPDATE application_ai_workflows
        SET status = 'completed', completed_at = NOW()
        WHERE id = ${workflowId}`,

      dbSql`INSERT INTO application_packets (application_id, base_resume_id, target_job_id, final_resume_version_id, created_by)
        VALUES (
          ${wf.application_id},
          ${wf.base_resume_id ?? null},
          ${tj.id},
          (SELECT id FROM application_resume_versions WHERE workflow_id = ${workflowId} ORDER BY created_at DESC LIMIT 1),
          NULL
        )
        ON CONFLICT (application_id) DO UPDATE SET
          final_resume_version_id = EXCLUDED.final_resume_version_id,
          base_resume_id = COALESCE(application_packets.base_resume_id, EXCLUDED.base_resume_id),
          target_job_id = COALESCE(application_packets.target_job_id, EXCLUDED.target_job_id)`,
    ]);
    const versionRow = versionRows[0];
    if (!versionRow?.id) throw new Error("Failed to insert resume version — no ID returned");
    versionId = versionRow.id;
  } catch (err: any) {
    throw new Error(`Finalization failed for workflow ${workflowId}: ${err.message || err}`);
  }

  // Log activity (best-effort — failure here does not roll back)
  await logActivity({
    userId: undefined,
    actorName: "AI Agent Pipeline",
    type: "update",
    description: `Multi-agent workflow completed. Resume version: ${versionId}`,
    entityType: "application",
    entityId: wf.application_id,
    entityName: `Workflow ${workflowId}`,
    metadata: { workflowId, versionId, artifactCount: artifacts.length, atsScore },
  }).catch((err: any) => {
    console.error("[finalizeWorkflow] Activity log failed (non-critical):", err.message || err);
  });

  return versionId;
}
