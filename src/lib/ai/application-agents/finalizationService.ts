// Finalization service — creates a proper application_resume_versions row
// linked explicitly to the workflow, target_job, application, job, and candidate.
// Persists the Final Polish output as a draft resume version regardless of its
// exportReady flag (see comment below) — only a missing artifact blocks this.
// Idempotent: calling twice returns the existing result.
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
import { enforceEducationIntegrity, enforceExperienceIntegrity, readBaseSummary } from "./resumeIntegrity";
import { auditAndRepairResumeVersionIdentity } from "./postFinalizeIdentityAudit";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import { renderResumePdfDoc } from "@/lib/falood/skarionPdfDocument";
import { archiveResumeToSharePoint } from "@/server/services/resumeSharePointArchiveService";

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

  // application_ai_workflows.base_resume_id's FK references base_resumes(id)
  // directly (confirmed live via pg_constraint) - startWorkflow() now stores
  // the real base_resumes.id there, so no extra indirection is needed here.
  // An earlier version of this comment/code assumed the opposite (that the
  // FK referenced application_resume_versions(id)) and resolved it via a
  // second lookup that - now that startWorkflow is fixed - would look up
  // application_resume_versions using a base_resumes id, finding nothing.
  const realBaseResumeId = wf.base_resume_id ?? null;

  const finalArtifact = artifacts.find((a) => a.automation_id === "application_final_polish");
  const finalData = finalArtifact?.data;

  if (!finalData) {
    const errMsg = "No Final Polish artifact found — pipeline incomplete.";
    await updateWorkflowStatus(workflowId, "failed", { last_error: errMsg });
    await query("UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $1 WHERE id = $2",
      [errMsg, wf.application_id]);
    return null;
  }

  // exportReady is a quality signal (single-page fit, no empty experience
  // section — see prompts/finalPolish.ts), not a safety gate: fabricated
  // claims are handled separately via requiredEdits/rejectedIssueIds, which
  // Final Polish is instructed to always resolve regardless of exportReady.
  // Previously exportReady !== true hard-failed the whole workflow with NO
  // resume saved anywhere, discarding three real (billed) agent calls' worth
  // of work and leaving the AE with nothing to open in Studio — worse than a
  // resume that needs a manual once-over. exportReady/unresolvedWarnings are
  // already surfaced as a "not ready" badge + warning list on the AI
  // findings page, so persisting it as a draft loses no visibility.
  const exportReady = (finalData as any)?.exportReady === true;

  const tj = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs
     WHERE candidate_id = $1 AND job_id = (SELECT job_id FROM applications WHERE id = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [wf.candidate_id, wf.application_id]
  );
  if (!tj) throw new Error(`No target_job found for candidate ${wf.candidate_id}`);

  // ATS score comes from the Hiring Panel review (ReviewScoreV1.atsScore, 0-10),
  // not the Final Polish QA score — that's the recruiter/HR/ATS-blend the studio
  // and queue surface to the applicant worker. Fall back to finalQaScore only
  // if the review artifact is somehow missing.
  const reviewArtifact = artifacts.find((a) => a.automation_id === "application_hiring_panel");
  const reviewData = reviewArtifact?.data as ReviewScoreV1 | undefined;
  // Some older hiring-panel artifacts contain a placeholder 0 even when Final
  // Polish produced a valid QA score. Prefer a positive, finite panel score;
  // otherwise use the final QA score instead of persisting a misleading zero.
  const panelAts = typeof reviewData?.atsScore === "number" && Number.isFinite(reviewData.atsScore)
    ? reviewData.atsScore : null;
  const finalQa = typeof (finalData as any).finalQaScore === "number" && Number.isFinite((finalData as any).finalQaScore)
    ? (finalData as any).finalQaScore : null;
  const atsScore = panelAts !== null && panelAts > 0 ? panelAts : finalQa ?? panelAts;
  const truthScore =
    typeof reviewData?.truthfulnessRisk === "number" ? Math.max(0, 10 - reviewData.truthfulnessRisk) : null;

  // pageFit is Final Polish's own measured (never LLM-guessed) page-fit
  // result - see hiringPanel.ts/finalPolish.ts/pageFitThresholds.ts.
  // one_page_fit_score is a simple 0-100 convenience number for quick
  // sorting/badges; page_fit_metrics carries the full detail.
  const finalPolishPageFit = (finalData as FinalResumeV1)?.pageFit ?? null;
  const onePageFitScore = finalPolishPageFit ? Math.round(finalPolishPageFit.contentUtilization * 1000) / 10 : null;
  const pageFitMetricsJson = finalPolishPageFit ? JSON.stringify(finalPolishPageFit) : null;

  // The agent schema (FinalResumeV1) carries no contact/identity data; the
  // studio's ResumeDocument shape needs the candidate's header, which lives on
  // the base resume content. Prefer the freshest base_resumes.content via
  // base_resume_id, falling back to the immutable workflow snapshot.
  let baseContent: any = null;
  if (realBaseResumeId) {
    const baseRow = await queryOne<{ content: any }>(
      "SELECT content FROM base_resumes WHERE id = $1",
      [realBaseResumeId]
    );
    baseContent = baseRow?.content ?? null;
  }
  if (!baseContent) {
    baseContent = (wf.config_snapshot?.baseResume as any)?.content ?? null;
  }

  // Finalization is the last safety boundary. Never persist an AI document that
  // silently dropped the candidate's employment or education. Final Polish has
  // its own integrity guard, but this protects production when an older worker,
  // partial artifact, or malformed provider response reaches finalization.
  const safeFinalData = { ...(finalData as FinalResumeV1) };
  const baseExperience = Array.isArray(baseContent?.experience) ? baseContent.experience : [];
  const baseEducation = Array.isArray(baseContent?.education) ? baseContent.education : [];
  if (baseExperience.length > 0) {
    safeFinalData.experience = enforceExperienceIntegrity(
      Array.isArray(safeFinalData.experience) ? safeFinalData.experience : [],
      baseExperience,
    ) as any;
  }
  if (baseEducation.length > 0) {
    safeFinalData.education = enforceEducationIntegrity(
      Array.isArray(safeFinalData.education) ? safeFinalData.education : [],
      baseEducation,
    ) as any;
  }
  // Last-line summary guard: same base-driven rule as Resume Forge and Final
  // Polish. Restore the base summary verbatim if the pipeline lost it; force
  // null when the base resume has no summary (nothing may ever be invented).
  const baseSummaryFinal = readBaseSummary(baseContent);
  if (baseSummaryFinal) {
    if (!safeFinalData.summary || !String(safeFinalData.summary).trim()) {
      safeFinalData.summary = baseSummaryFinal;
      console.warn("[finalizeWorkflow] SUMMARY GUARD: restored base professional summary (pipeline returned none)");
    }
  } else {
    safeFinalData.summary = null;
  }
  if (baseExperience.length > 0 && safeFinalData.experience.length === 0) {
    throw new Error("Final resume safety check failed: employment section is empty");
  }
  if (baseEducation.length > 0 && safeFinalData.education.length === 0) {
    throw new Error("Final resume safety check failed: education section is empty");
  }
  const studioDocument = finalResumeToStudioDocument(safeFinalData, baseContent);

  // ATOMICITY BOUNDARY (critical path): all three operations run inside a single
  // database transaction via Neon's sql.transaction(). If any query fails, the
  // entire transaction rolls back, preventing partial finalization.
  const jobInfo = await queryOne<{ job_title: string | null }>(
    "SELECT title AS job_title FROM jobs WHERE id = $1",
    [wf.job_id]
  );
  const jobTitle = jobInfo?.job_title?.trim();
  const title = jobTitle ? `${jobTitle} — Tailored Resume` : "AI-Generated Tailored Resume";
  const contentJson = JSON.stringify(studioDocument);
  const dbSql = getSql();
  let versionId: string | null = null;
  try {
    const [, versionRows] = await dbSql.transaction([
      dbSql`INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_by_name, reason, source)
        SELECT id, ae_stage, 'ready_for_review', 'AI Pipeline (auto)', 'AI resume finalization completed', 'ai_pipeline'
        FROM applications
        WHERE id = ${wf.application_id} AND ae_stage = 'in_ai_pipeline'`,
      dbSql`WITH inserted AS (
         INSERT INTO application_resume_versions
           (candidate_id, target_job_id, application_id, job_id, workflow_id, base_resume_id,
            title, content, source_type, status, ats_score, truth_score, one_page_fit_score, page_fit_metrics, created_at)
         VALUES (${wf.candidate_id}, ${tj.id}, ${wf.application_id}, ${wf.job_id ?? null}, ${workflowId}, ${realBaseResumeId},
                 ${title}, ${contentJson}, 'ai_agent', 'draft', ${atsScore}, ${truthScore}, ${onePageFitScore}, ${pageFitMetricsJson}, NOW())
         ON CONFLICT (workflow_id) WHERE source_type = 'ai_agent'
         DO UPDATE SET content = EXCLUDED.content, ats_score = EXCLUDED.ats_score,
                       truth_score = EXCLUDED.truth_score, one_page_fit_score = EXCLUDED.one_page_fit_score,
                       page_fit_metrics = EXCLUDED.page_fit_metrics, updated_at = NOW()
         RETURNING id
       )
       UPDATE applications SET
         tailored_resume_version_id = inserted.id,
         ai_workflow_id = ${workflowId},
         resume_generation_status = 'ready',
         resume_generation_completed_at = NOW(),
         ae_stage = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN 'ready_for_review' ELSE applications.ae_stage END,
         application_stage = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN 'ready_for_review' ELSE COALESCE(applications.application_stage, applications.ae_stage) END,
         ae_stage_updated_at = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN NOW() ELSE applications.ae_stage_updated_at END,
         ae_stage_updated_by_name = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN 'AI Pipeline (auto)' ELSE applications.ae_stage_updated_by_name END,
         application_stage_changed_at = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN NOW() ELSE applications.application_stage_changed_at END,
         application_stage_changed_by_name = CASE WHEN applications.ae_stage = 'in_ai_pipeline' THEN 'AI Pipeline (auto)' ELSE applications.application_stage_changed_by_name END
       FROM inserted
       WHERE applications.id = ${wf.application_id}
       RETURNING inserted.id`,

      dbSql`UPDATE application_ai_workflows
        SET status = 'completed', completed_at = NOW(), last_error = NULL
        WHERE id = ${workflowId}`,

      dbSql`INSERT INTO application_packets (application_id, base_resume_id, target_job_id, final_resume_version_id, created_by)
        VALUES (
          ${wf.application_id},
          ${realBaseResumeId},
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

  if (!exportReady) {
    console.warn(`[finalizeWorkflow] Workflow ${workflowId} completed with exportReady=false — resume saved as draft, needs manual review (see unresolvedWarnings).`);
  }

  // Auto-archive to SharePoint (best-effort — the resume version row above is
  // already committed regardless of what happens here). Renders the exact
  // same studioDocument that was just persisted, through the same renderer
  // Studio's manual Export button uses, so the archived PDF is never out of
  // sync with what a reviewer sees on screen. A render/upload failure here
  // must never fail workflow finalization — see resumeSharePointArchiveService,
  // which also records the failure on application_resume_exports so the
  // candidate profile's "Sharepoint" button can report "not archived" instead
  // of silently claiming success.
  try {
    const info = await queryOne<{ candidate_name: string; company_name: string | null; job_title: string | null }>(
      `SELECT c.name AS candidate_name, j.company AS company_name, j.title AS job_title
       FROM candidates c
       LEFT JOIN jobs j ON j.id = $2
       WHERE c.id = $1`,
      [wf.candidate_id, wf.job_id]
    );
    const doc = renderResumePdfDoc(normalizeResumeContentForExport(studioDocument));
    const pdfBuffer = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
    const archiveResult = await archiveResumeToSharePoint({
      applicationId: wf.application_id,
      resumeVersionId: versionId!,
      exportType: "pdf",
      candidateId: wf.candidate_id,
      candidateName: info?.candidate_name ?? null,
      companyName: info?.company_name ?? null,
      jobTitle: info?.job_title ?? null,
      jobId: wf.job_id,
      buffer: pdfBuffer,
      createdByUserId: null,
    });
    if (!archiveResult.ok) {
      console.warn(`[finalizeWorkflow] SharePoint auto-archive failed for workflow ${workflowId} (resume version ${versionId}): ${archiveResult.error}`);
    }
  } catch (err: any) {
    console.warn(`[finalizeWorkflow] SharePoint auto-archive threw for workflow ${workflowId} (resume version ${versionId}):`, err?.message || err);
  }

  // Log activity (best-effort — failure here does not roll back)
  await logActivity({
    userId: undefined,
    actorName: "AI Agent Pipeline",
    type: "update",
    description: exportReady
      ? `Multi-agent workflow completed. Resume version: ${versionId}`
      : `Multi-agent workflow completed with quality warnings (not export-ready — needs review). Resume version: ${versionId}`,
    entityType: "application",
    entityId: wf.application_id,
    entityName: `Workflow ${workflowId}`,
    metadata: { workflowId, versionId, artifactCount: artifacts.length, atsScore, exportReady },
  }).catch((err: any) => {
    console.error("[finalizeWorkflow] Activity log failed (non-critical):", err.message || err);
  });

  // Independent final identity check, deliberately re-reading and
  // re-comparing rather than trusting the enforceExperienceIntegrity/
  // enforceEducationIntegrity calls above by construction - see
  // postFinalizeIdentityAudit.ts. Must never block/fail finalization: the
  // version row above is already committed regardless of what happens here.
  try {
    const auditResult = await auditAndRepairResumeVersionIdentity(versionId!);
    if (auditResult.changed) {
      console.warn(
        `[finalizeWorkflow] POST-FINALIZE IDENTITY AUDIT repaired ${auditResult.mismatches.length} mismatch(es) on resume version ${versionId}:`,
        auditResult.mismatches
      );
    } else if (auditResult.mismatches.length > 0) {
      console.warn(
        `[finalizeWorkflow] POST-FINALIZE IDENTITY AUDIT found unrepairable issue(s) on resume version ${versionId} (needs human review):`,
        auditResult.mismatches
      );
    }
  } catch (err: any) {
    console.error(`[finalizeWorkflow] Post-finalize identity audit threw for resume version ${versionId}:`, err?.message || err);
  }

  return versionId;
}
