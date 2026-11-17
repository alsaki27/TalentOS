import { execute, query, queryOne } from "@/server/db/neon";
import { resumePdfJobsAvailable } from "@/server/repositories/approvedResumePdfRepository";
import {
  listTemporaryResumePdfs, readTemporaryResumePdf, removeTemporaryResumePdf, TEMPORARY_RESUME_PDF_PROVIDER,
} from "@/server/storage/approvedResumePdfStorage";
import {
  approveEvidenceResumeForApplication, ResumeReleaseChangedError, ResumeReleaseReviewRequiredError, ResumeSavedRevisionChangedError,
} from "./resumeEvidenceReleaseService";
import { uploadVerifiedResumeArchive } from "./resumeSharePointArchiveService";

type RefreshJob = {
  resume_version_id: string; application_id: string; workflow_id: string; revision: string;
  editor_id: string; attempts: number;
};
type ArchiveJob = { export_id: string; temporary_key: string; state: "pending" | "cleanup"; attempts: number };
const retryAfter = (attempts: number) => Math.min(3600, 30 * 2 ** Math.min(attempts, 7));

export async function refreshOneApprovedResumePdf(versionId?: string) {
  const lease = crypto.randomUUID();
  const job = await queryOne<RefreshJob>(
    `UPDATE application_resume_pdf_refresh_jobs r SET lease_token=$1,lease_until=NOW()+interval '3 minutes',attempts=r.attempts+1
      WHERE resume_version_id = (
        SELECT resume_version_id FROM application_resume_pdf_refresh_jobs
        WHERE state='pending' AND next_attempt_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW())
          AND ($2::uuid IS NULL OR resume_version_id=$2::uuid)
        ORDER BY next_attempt_at,resume_version_id LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING r.*`,
    [lease, versionId ?? null],
  );
  if (!job) return false;

  let state = "complete";
  let error: string | null = null;
  try {
    const ticket = await queryOne<{ stage: string }>(
      `SELECT COALESCE(a.application_stage,a.ae_stage) AS stage FROM applications a
        WHERE a.id=$1 AND a.tailored_resume_version_id=$2 AND a.ai_workflow_id=$3
          AND COALESCE(a.application_stage,a.ae_stage) IN ('ready_for_application','applied')`,
      [job.application_id, job.resume_version_id, job.workflow_id],
    );
    if (!ticket) state = "superseded";
    else await approveEvidenceResumeForApplication(job.application_id, job.editor_id, ticket.stage, job.revision, { refreshLease: lease });
  } catch (cause) {
    if (cause instanceof ResumeSavedRevisionChangedError) {
      state = "superseded";
    } else if (cause instanceof ResumeReleaseReviewRequiredError) {
      state = "blocked";
      error = cause.message;
    } else {
      state = "pending";
      error = cause instanceof ResumeReleaseChangedError ? "The saved résumé changed during refresh." : "Could not refresh the approved PDF.";
    }
  }
  await execute(
    `WITH current_version AS MATERIALIZED (
      SELECT id FROM application_resume_versions WHERE id=$1 FOR UPDATE
     ), finished AS (
      UPDATE application_resume_pdf_refresh_jobs SET
      state=CASE WHEN revision=$3 THEN $4 ELSE state END,
      last_error=CASE WHEN revision=$3 THEN $5 ELSE last_error END,
      next_attempt_at=CASE WHEN revision=$3 AND $4='pending' THEN NOW()+make_interval(secs=>$6) ELSE next_attempt_at END,
      lease_token=NULL,lease_until=NULL,updated_at=NOW()
      FROM current_version WHERE resume_version_id=current_version.id AND lease_token=$2
      RETURNING resume_version_id,revision,state,last_error
     )
     UPDATE application_resume_versions v SET pdf_refresh_state=finished.state,pdf_refresh_error=finished.last_error
       FROM finished WHERE v.id=finished.resume_version_id AND finished.revision=$3`,
    [job.resume_version_id, lease, job.revision, state, error, retryAfter(job.attempts)],
  );
  return true;
}

async function archiveOneApprovedResumePdf() {
  const lease = crypto.randomUUID();
  const job = await queryOne<ArchiveJob>(
    `UPDATE application_resume_pdf_archive_jobs q SET lease_token=$1,lease_until=NOW()+interval '3 minutes',attempts=q.attempts+1
      WHERE export_id = (
        SELECT export_id FROM application_resume_pdf_archive_jobs
        WHERE state IN ('pending','cleanup') AND next_attempt_at<=NOW() AND (lease_until IS NULL OR lease_until<NOW())
        ORDER BY next_attempt_at,export_id LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING q.*`, [lease],
  );
  if (!job) return false;

  let state = job.state as string;
  let error: string | null = null;
  let delay = retryAfter(job.attempts);
  try {
    if (job.state === "pending") {
      const source = await queryOne<{
        application_id: string; resume_version_id: string; candidate_id: string; job_id: string | null;
        content_sha256: string; storage_provider: string; candidate_name_snapshot: string;
        company_name_snapshot: string | null; job_title_snapshot: string | null;
      }>(
        `SELECT x.*, a.candidate_id, a.job_id FROM application_resume_exports x JOIN applications a ON a.id=x.application_id
          WHERE x.id=$1 AND x.status='created'`, [job.export_id],
      );
      if (!source || source.storage_provider !== TEMPORARY_RESUME_PDF_PROVIDER) throw new Error("The approved PDF archive source changed.");
      const buffer = await readTemporaryResumePdf(job.temporary_key, source.content_sha256);
      const copy = await uploadVerifiedResumeArchive({
        applicationId: source.application_id, resumeVersionId: source.resume_version_id,
        candidateId: source.candidate_id, jobId: source.job_id, candidateName: source.candidate_name_snapshot,
        companyName: source.company_name_snapshot, jobTitle: source.job_title_snapshot,
        variantLabel: source.content_sha256, exportType: "pdf", buffer,
      }, source.content_sha256);
      const switched = await queryOne(
        `WITH source_export AS MATERIALIZED (
           SELECT id FROM application_resume_exports WHERE id=$1 FOR UPDATE
         ), owned AS MATERIALIZED (
           SELECT q.export_id FROM application_resume_pdf_archive_jobs q JOIN source_export x ON x.id=q.export_id
           WHERE lease_token=$2
             AND state='pending' AND lease_until>NOW() FOR UPDATE
         ), archived AS (
           UPDATE application_resume_exports x SET storage_provider='sharepoint', storage_url=$3, storage_item_id=$4,
             file_path=$5, file_name=$6, pdf_archive_state='cleanup', updated_at=NOW()
           FROM owned WHERE x.id=owned.export_id AND x.status='created' AND x.content_sha256=$7
             AND x.storage_provider=$8 AND x.file_path=$9 RETURNING x.id
         )
         UPDATE application_resume_pdf_archive_jobs q SET state='cleanup',attempts=0,updated_at=NOW()
         FROM archived WHERE q.export_id=archived.id RETURNING q.export_id`,
        [job.export_id, lease, copy.url, copy.itemId, copy.path, copy.fileName, source.content_sha256,
          TEMPORARY_RESUME_PDF_PROVIDER, job.temporary_key],
      );
      if (!switched) throw new Error("The archive claim changed before saving the SharePoint reference.");
      state = "cleanup";
    }
    await removeTemporaryResumePdf(job.temporary_key);
    state = "complete";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const response = cause as { status?: number; retryAfterSeconds?: number } | null;
    if (response?.retryAfterSeconds) delay = Math.max(delay, Math.min(response.retryAfterSeconds, 24 * 3600));
    if (state === "pending" && (/pathistoolong|insufficient room/i.test(message) || response?.status === 401 || response?.status === 403 ||
      (job.attempts >= 3 && /checksum does not match/i.test(message)))) {
      state = "blocked";
      error = /checksum/i.test(message) ? "SharePoint returned different PDF bytes."
        : response?.status === 401 || response?.status === 403 ? "SharePoint rejected archive access."
          : "The SharePoint archive path is too long.";
    } else {
      error = state === "cleanup" ? "Temporary PDF cleanup will retry." : "SharePoint archive copy will retry.";
    }
  }
  await execute(
    `WITH source_export AS MATERIALIZED (
      SELECT id FROM application_resume_exports WHERE id=$1 FOR UPDATE
     ), finished AS (
     UPDATE application_resume_pdf_archive_jobs SET state=$3,last_error=$4,lease_token=NULL,lease_until=NULL,
      next_attempt_at=CASE WHEN $4::text IS NOT NULL THEN NOW()+make_interval(secs=>$5) ELSE next_attempt_at END,
      updated_at=NOW() FROM source_export WHERE export_id=source_export.id AND lease_token=$2 RETURNING export_id,state
     )
     UPDATE application_resume_exports x SET pdf_archive_state=finished.state FROM finished WHERE x.id=finished.export_id`,
    [job.export_id, lease, state, error, delay],
  );
  return true;
}

export async function kickSavedResumePdfRefresh(versionId: string) {
  if (!await resumePdfJobsAvailable()) return false;
  return refreshOneApprovedResumePdf(versionId);
}

async function removeUnpublishedTemporaryPdfs() {
  // The random suffix gives every write its own key. An old unpublished key
  // cannot be selected by a future approval. Referenced files remain available
  // even when SharePoint has been unavailable for longer than this interval.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  do {
    const page = await listTemporaryResumePdfs(cursor);
    if (!page) return;
    const keys = page.objects.filter(object => object.uploaded.getTime() < cutoff).map(object => object.key);
    if (keys.length) {
      const referenced = new Set((await query<{ key: string }>(
        `SELECT file_path AS key FROM application_resume_exports WHERE storage_provider=$2 AND file_path=ANY($1::text[])
         UNION SELECT temporary_key FROM application_resume_pdf_archive_jobs WHERE temporary_key=ANY($1::text[])`,
        [keys, TEMPORARY_RESUME_PDF_PROVIDER],
      )).map(row => row.key));
      await Promise.all(keys.filter(key => !referenced.has(key)).map(removeTemporaryResumePdf));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function runApprovedResumePdfJobs(sweep = false) {
  if (!await resumePdfJobsAvailable()) return { refreshed: false, archived: false };
  const [refreshed, archived] = await Promise.all([
    refreshOneApprovedResumePdf(), archiveOneApprovedResumePdf(), sweep ? removeUnpublishedTemporaryPdfs() : undefined,
  ]);
  return { refreshed, archived };
}
