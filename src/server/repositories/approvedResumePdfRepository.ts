import { queryOne, sql } from "@/server/db/neon";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";
import { applicationUpdateStatement, type ApplicationRow, type UpdateApplicationInput } from "./applicationsRepository";

export function resumePdfJobsAvailable() {
  return queryOne<{ installed: boolean }>(
    "SELECT to_regclass('public.application_resume_pdf_refresh_jobs') IS NOT NULL AND to_regclass('public.application_resume_pdf_archive_jobs') IS NOT NULL AS installed",
  ).then(result => result?.installed === true);
}

type PublishPdf = {
  applicationId: string; versionId: string; workflowId: string; revision: string; updatedAt: string;
  stage: string | null; reviewStatus: string | null; actorId: string; refreshLease?: string;
  temporaryKey: string; hash: string; size: number; metrics: unknown; contentHash: string;
  candidateName: string; company: string | null; jobTitle: string | null;
  advance?: { updates: UpdateApplicationInput; previousReviewStatus: string | null };
};

export async function publishStagedResumePdf(input: PublishPdf) {
  const recorded = new Date().toISOString();
  const existingArchive = `application_resume_exports.status = 'created'
    AND ((application_resume_exports.storage_provider = 'sharepoint' AND application_resume_exports.storage_url IS NOT NULL)
      OR application_resume_exports.storage_provider = $10)`;
  const statement = `
    WITH authorized AS MATERIALIZED (
      SELECT a.id FROM applications a JOIN application_resume_versions v
        ON v.id = a.tailored_resume_version_id AND v.application_id = a.id
      WHERE a.id = $1 AND v.id = $2 AND a.ai_workflow_id = $3 AND v.workflow_id = a.ai_workflow_id
        AND v.updated_at IS NOT DISTINCT FROM $4::timestamptz
        AND COALESCE(a.application_stage,a.ae_stage) IS NOT DISTINCT FROM $5
        AND a.review_status IS NOT DISTINCT FROM $6 AND a.review_status IS DISTINCT FROM 'changes_requested'
        AND ($7::uuid IS NOT NULL OR a.applied_at IS NULL)
        AND ($7::uuid IS NULL OR EXISTS (
          SELECT 1 FROM application_resume_pdf_refresh_jobs r WHERE r.resume_version_id = v.id
            AND r.application_id = a.id AND r.workflow_id = a.ai_workflow_id AND r.revision = $8
            AND r.lease_token = $7::uuid AND r.state = 'pending' AND r.lease_until > NOW()
        ))
      FOR NO KEY UPDATE OF a, v
    ), stored AS (
      INSERT INTO application_resume_exports (application_id,resume_version_id,export_type,file_name,file_path,
        storage_provider,file_size_bytes,status,content_sha256,created_by,candidate_name_snapshot,company_name_snapshot,job_title_snapshot,pdf_archive_state,updated_at)
      SELECT id,$2,'pdf','Approved resume.pdf',$9,$10,$11,'created',$12,$13,$14,$15,$16,'pending',NOW() FROM authorized
      ON CONFLICT (application_id,resume_version_id,export_type,content_sha256)
        WHERE content_sha256 IS NOT NULL AND status <> 'deleted'
      DO UPDATE SET
        status = 'created', error = NULL,
        file_path = CASE WHEN ${existingArchive} THEN application_resume_exports.file_path ELSE EXCLUDED.file_path END,
        storage_provider = CASE WHEN ${existingArchive} THEN application_resume_exports.storage_provider ELSE EXCLUDED.storage_provider END,
        storage_url = CASE WHEN ${existingArchive} THEN application_resume_exports.storage_url END,
        storage_item_id = CASE WHEN ${existingArchive} THEN application_resume_exports.storage_item_id END,
        pdf_archive_state = CASE WHEN ${existingArchive} THEN application_resume_exports.pdf_archive_state ELSE EXCLUDED.pdf_archive_state END,
        file_size_bytes = EXCLUDED.file_size_bytes, updated_at = NOW()
      RETURNING id, storage_provider, file_path
    ), receipt AS (
      UPDATE application_resume_versions v SET status = 'approved', updated_at = NOW(),
        release_receipt = $17::jsonb || jsonb_build_object('exportId',stored.id)
      FROM stored WHERE v.id = $2 RETURNING v.id
    ), archive AS (
      INSERT INTO application_resume_pdf_archive_jobs (export_id, temporary_key, state)
      SELECT id,file_path,'pending' FROM stored WHERE storage_provider = $10
      ON CONFLICT (export_id) DO UPDATE SET
        state = 'pending', next_attempt_at = NOW(), temporary_key = EXCLUDED.temporary_key,
        lease_token = NULL, lease_until = NULL, attempts = 0, last_error = NULL
        WHERE application_resume_pdf_archive_jobs.temporary_key <> EXCLUDED.temporary_key
    )
    SELECT receipt.id, (stored.storage_provider = $10 AND stored.file_path = $9) AS retained FROM receipt, stored`;
  const params = [input.applicationId, input.versionId, input.workflowId, input.updatedAt, input.stage,
    input.advance ? input.advance.previousReviewStatus : input.reviewStatus,
    input.refreshLease ?? null, input.revision, input.temporaryKey, TEMPORARY_RESUME_PDF_PROVIDER,
    input.size, input.hash, input.actorId, input.candidateName, input.company, input.jobTitle,
    JSON.stringify({
      pdfHash: input.hash, contentHash: input.contentHash, revision: input.revision,
      approvedBy: input.actorId, approvedAt: recorded, automaticRefresh: Boolean(input.refreshLease), metrics: input.metrics,
    })];
  if (!input.advance) {
    const receipt = await queryOne<{ retained: boolean }>(statement, params);
    return { published: Boolean(receipt), retained: receipt?.retained === true, application: undefined };
  }

  const next = applicationUpdateStatement(input.applicationId, input.advance.updates, {
    stage: input.stage, reviewStatus: input.advance.previousReviewStatus,
    approvedPdf: { versionId: input.versionId, revision: input.revision, hash: input.hash },
  });
  const connection = sql();
  const [receipt, rows] = await connection.transaction<any>([
    connection.query(statement, params),
    connection.query(next.statement, next.values),
  ]);
  return { published: receipt.length > 0, retained: receipt[0]?.retained === true, application: rows[0] as ApplicationRow | undefined };
}
