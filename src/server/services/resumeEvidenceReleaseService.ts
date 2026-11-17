import { RESUME_EVIDENCE_VARIANT } from "@/lib/ai/application-agents/workflowStages";
import { queryOne } from "@/server/db/neon";
import { archiveResumeToSharePoint } from "./resumeSharePointArchiveService";
import { getStudioApprovalPdf, StudioResumeLayoutError } from "./studioResumePdf";

export class ResumeReleaseError extends Error {}
export class ResumeReleaseChangedError extends ResumeReleaseError {}

export const RESUME_RELEASE_REQUIRED_MESSAGE =
  "The current saved résumé needs approval. Select AE Applied on the ticket to confirm it.";

// Approval changes status and timestamps. The confirmation follows the saved
// document fields that invalidate the release receipt, not timestamp writes.
const savedResumeRevisionSql = `v.id::text || ':' ||
  encode(sha256(convert_to(jsonb_build_array(v.content, v.formatting, v.generated_text)::text, 'UTF8')), 'hex')`;

export async function findResumeApprovalRevision(applicationId: string) {
  const source = await queryOne<{ revision: string }>(
    `SELECT ${savedResumeRevisionSql} AS revision
       FROM applications a JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
       JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id
         AND v.application_id = a.id AND v.workflow_id = w.id
      WHERE a.id = $1 AND a.applied_at IS NULL
        AND COALESCE(a.application_stage, a.ae_stage) = 'ready_for_application'
        AND w.config_snapshot->>'pipelineVariant' = $2 AND w.status = 'completed'
        AND v.content IS NOT NULL`,
    [applicationId, RESUME_EVIDENCE_VARIANT],
  );
  return source?.revision ?? null;
}

export function isResumeReleaseGateError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23514"
    && error.message === "Approve and validate the current resume PDF before moving this application forward";
}

export async function evidenceResumeExportIsAllowed(applicationId: string, resumeVersionId: string, exportId?: string) {
  const gate = await queryOne<{ allowed: boolean }>(
    `SELECT (w.config_snapshot->>'pipelineVariant' IS DISTINCT FROM $3 OR (
        v.id = a.tailored_resume_version_id AND v.workflow_id = w.id AND v.status = 'approved'
        AND $4::text IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM application_resume_exports x WHERE x.id::text = $4::text
            AND x.application_id = a.id AND x.resume_version_id = v.id
            AND x.id::text = to_jsonb(v)->'release_receipt'->>'exportId'
            AND x.content_sha256 = to_jsonb(v)->'release_receipt'->>'pdfHash'
            AND x.export_type = 'pdf' AND x.status = 'created'
        )
      )) AS allowed
      FROM applications a LEFT JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
      JOIN application_resume_versions v ON v.id = $2
      WHERE a.id = $1`,
    [applicationId, resumeVersionId, RESUME_EVIDENCE_VARIANT, exportId ?? null],
  );
  return gate?.allowed === true;
}

export async function approveEvidenceResumeForApplication(
  applicationId: string, reviewerId: string, expectedStage: string | null, expectedRevision?: string,
) {
  const started = performance.now();
  const source = await queryOne<{
    version_id: string | null; content: unknown; candidate_id: string; candidate_name: string;
    job_id: string | null; job_title: string | null; company: string | null; workflow_id: string;
    finalized: boolean; review_required: boolean; updated_at: string;
    edited: boolean; approval_status: string | null; export_id: string | null; revision: string | null;
  }>(
    `SELECT v.id AS version_id, v.content, a.candidate_id, c.name AS candidate_name,
            a.job_id, j.title AS job_title, j.company, w.id AS workflow_id, w.status = 'completed' AS finalized,
            v.updated_at::text AS updated_at, ${savedResumeRevisionSql} AS revision,
            release_artifact.data->>'exportReady' IS DISTINCT FROM 'true' AS review_required,
            v.updated_by_user_id IS NOT NULL AS edited,
            a.review_status AS approval_status, stored.id::text AS export_id
     FROM applications a JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
     JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id AND v.workflow_id = w.id
       AND v.application_id = a.id
     LEFT JOIN application_resume_exports stored ON stored.id::text = to_jsonb(v)->'release_receipt'->>'exportId'
       AND stored.content_sha256 = to_jsonb(v)->'release_receipt'->>'pdfHash'
       AND stored.application_id = a.id AND stored.resume_version_id = v.id
       AND stored.export_type = 'pdf' AND stored.status = 'created' AND v.status = 'approved'
     LEFT JOIN LATERAL (
       SELECT artifact.data FROM application_ai_stage_runs sr
       JOIN application_ai_artifacts artifact ON artifact.id = sr.output_artifact_id
       WHERE sr.workflow_id = w.id AND sr.automation_id = 'application_release_editor'
         AND sr.status = 'success'
         AND sr.attempt_number > COALESCE((w.config_snapshot->'resumeReplayThrough'->>sr.sequence_number::text)::integer, 0)
       ORDER BY sr.attempt_number DESC LIMIT 1
     ) release_artifact ON true
     WHERE a.id = $1 AND a.applied_at IS NULL AND w.config_snapshot->>'pipelineVariant' = $2`,
    [applicationId, RESUME_EVIDENCE_VARIANT],
  );
  if (expectedRevision !== undefined && source?.revision !== expectedRevision) {
    throw new ResumeReleaseChangedError("The saved résumé changed. Review the current version in Studio and select AE Applied again.");
  }
  if (!source || source.export_id) return;
  if (!source.finalized || !source.version_id || !source.content) {
    throw new ResumeReleaseError("The current resume draft is still being prepared");
  }
  if (source.approval_status === "changes_requested" || (source.review_required && !source.edited)) {
    throw new ResumeReleaseError("Open the draft and resolve the review findings before approving it");
  }

  const fetched = performance.now();
  const pdf = await getStudioApprovalPdf(source.version_id, source.content).catch(error => {
    if (error instanceof StudioResumeLayoutError) throw new ResumeReleaseError(error.message);
    console.error("[resume-approval] Studio PDF rendering failed", error instanceof Error ? error.name : typeof error);
    throw new ResumeReleaseError("Could not render the saved Studio PDF. Please retry approval.");
  });
  if (!pdf) throw new ResumeReleaseError("Could not render the saved Studio PDF. Please retry approval.");
  const rendered = performance.now();
  const result = await archiveResumeToSharePoint({
    applicationId, resumeVersionId: source.version_id, exportType: "pdf",
    candidateId: source.candidate_id, candidateName: source.candidate_name,
    companyName: source.company, jobTitle: source.job_title, jobId: source.job_id,
    buffer: pdf.bytes, createdByUserId: reviewerId, variantLabel: pdf.pdfHash, preferExistingFolder: true,
  });
  if (!result.ok || !result.id) throw new ResumeReleaseError("Could not save the validated PDF. Retry approval to resume from the PDF.");
  const archived = performance.now();
  const receipt = { exportId: result.id, pdfHash: pdf.pdfHash, contentHash: pdf.contentHash, approvedBy: reviewerId, metrics: pdf.metrics };
  const approved = await queryOne(
    `WITH authorized AS MATERIALIZED (
       SELECT a.id FROM applications a WHERE a.id = $1 AND a.applied_at IS NULL
         AND a.tailored_resume_version_id = $2
         AND a.ai_workflow_id = $6
         AND COALESCE(a.application_stage, a.ae_stage) IS NOT DISTINCT FROM $7
         AND a.review_status IS DISTINCT FROM 'changes_requested'
       FOR UPDATE
     )
     UPDATE application_resume_versions v
       SET status = 'approved', release_receipt = $4::jsonb, updated_at = NOW()
       FROM authorized app
       WHERE v.id = $2 AND v.application_id = app.id AND v.workflow_id = $6 AND v.content::jsonb = $3::jsonb
         AND v.updated_at IS NOT DISTINCT FROM $5::timestamptz
       RETURNING v.id`,
    [applicationId, source.version_id, JSON.stringify(source.content), JSON.stringify(receipt), source.updated_at, source.workflow_id, expectedStage],
  );
  if (!approved) throw new ResumeReleaseChangedError("The resume changed while approving it. Reopen the current version and try again.");
  return {
    pageCount: pdf.metrics.pageCount,
    prepared: pdf.prepared,
    timings: {
      release_lookup: Math.round(fetched - started),
      studio_render: Math.round(rendered - fetched),
      ...pdf.timings,
      sharepoint_archive: Math.round(archived - rendered),
      release_receipt: Math.round(performance.now() - archived),
    },
  };
}

export async function prepareSavedApprovalPdf(versionId: string) {
  const source = await queryOne<{ content: unknown }>(
    `SELECT v.content
       FROM applications a
       JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id AND v.status = 'draft'
       JOIN application_ai_workflows w ON w.id = a.ai_workflow_id AND w.id = v.workflow_id
      WHERE v.id = $1 AND v.updated_by_user_id IS NOT NULL
        AND COALESCE(a.application_stage, a.ae_stage) IN ('ready_for_review', 'ready_for_application')
        AND a.applied_at IS NULL
        AND a.review_status IS DISTINCT FROM 'changes_requested'
        AND w.status = 'completed' AND w.config_snapshot->>'pipelineVariant' = $2`,
    [versionId, RESUME_EVIDENCE_VARIANT],
  );
  if (source) await getStudioApprovalPdf(versionId, source.content, true);
}
