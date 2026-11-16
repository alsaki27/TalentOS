import { RESUME_EVIDENCE_VARIANT } from "@/lib/ai/application-agents/workflowStages";
import { renderEvidenceReleasePdf } from "@/lib/ai/application-agents/resumeReleasePdf";
import { queryOne } from "@/server/db/neon";
import { archiveResumeToSharePoint } from "./resumeSharePointArchiveService";

export class ResumeReleaseError extends Error {}

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

export async function approveEvidenceResumeForApplication(applicationId: string, reviewerId: string) {
  const source = await queryOne<{
    version_id: string | null; content: unknown; candidate_id: string; candidate_name: string;
    job_id: string | null; job_title: string | null; company: string | null;
    finalized: boolean; review_required: boolean; updated_at: string; max_pages: number | null;
    edited: boolean; approval_status: string | null; export_id: string | null;
  }>(
    `SELECT v.id AS version_id, v.content, a.candidate_id, c.name AS candidate_name,
            a.job_id, j.title AS job_title, j.company, w.status = 'completed' AS finalized,
            v.updated_at::text AS updated_at, (w.config_snapshot->>'resumeMaxPages')::integer AS max_pages,
            release_artifact.data->>'exportReady' IS DISTINCT FROM 'true' AS review_required,
            v.updated_by_user_id IS NOT NULL AS edited,
            a.review_status AS approval_status, stored.id::text AS export_id
     FROM applications a JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
     JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id AND v.workflow_id = w.id
     LEFT JOIN application_resume_exports stored ON stored.id::text = to_jsonb(v)->'release_receipt'->>'exportId'
       AND stored.content_sha256 = to_jsonb(v)->'release_receipt'->>'pdfHash'
       AND stored.status = 'created' AND v.status = 'approved'
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
  if (!source || source.export_id) return;
  if (!source.finalized || !source.version_id || !source.content) {
    throw new ResumeReleaseError("The current resume draft is still being prepared");
  }
  if (source.approval_status === "changes_requested" || (source.review_required && !source.edited)) {
    throw new ResumeReleaseError("Open the draft and resolve the review findings before approving it");
  }

  const pdf = await renderEvidenceReleasePdf(source.content, source.max_pages ?? 2).catch(() => null);
  if (!pdf?.passed) throw new ResumeReleaseError("The current PDF needs layout or identity corrections");
  const result = await archiveResumeToSharePoint({
    applicationId, resumeVersionId: source.version_id, exportType: "pdf",
    candidateId: source.candidate_id, candidateName: source.candidate_name,
    companyName: source.company, jobTitle: source.job_title, jobId: source.job_id,
    buffer: pdf.bytes, createdByUserId: reviewerId, variantLabel: pdf.pdfHash,
  });
  if (!result.ok || !result.id) throw new ResumeReleaseError("Could not save the validated PDF. Retry approval to resume from the PDF.");
  const receipt = { exportId: result.id, pdfHash: pdf.pdfHash, contentHash: pdf.contentHash, approvedBy: reviewerId, metrics: pdf.metrics };
  const approved = await queryOne(
    `WITH authorized AS MATERIALIZED (
       SELECT a.id FROM applications a WHERE a.id = $1 AND a.applied_at IS NULL
         AND a.tailored_resume_version_id = $2
         AND a.review_status IS DISTINCT FROM 'changes_requested'
       FOR UPDATE
     )
     UPDATE application_resume_versions v
       SET status = 'approved', release_receipt = $4::jsonb, updated_at = NOW()
       FROM authorized app
       WHERE v.id = $2 AND v.application_id = app.id AND v.content::jsonb = $3::jsonb
         AND v.updated_at IS NOT DISTINCT FROM $5::timestamptz
       RETURNING v.id`,
    [applicationId, source.version_id, JSON.stringify(source.content), JSON.stringify(receipt), source.updated_at],
  );
  if (!approved) throw new ResumeReleaseError("The resume changed while approving it. Reopen the current version and try again.");
}
