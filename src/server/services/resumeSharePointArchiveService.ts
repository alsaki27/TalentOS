// src/server/services/resumeSharePointArchiveService.ts
// Writes a rendered resume PDF/DOCX to SharePoint and records the archive in
// application_resume_exports. This is the exact upload+record logic that
// previously lived inline in api/applications/exports/route.ts (the manual
// Studio "Export" button); it now also backs the automatic
// archive-on-finalization hook in finalizationService.ts, so both paths leave
// application_resume_exports in an identical, trustworthy shape regardless of
// which one created the row.

import { query, queryOne } from "@/server/db/neon";
import { openSharePointItem, sharePointResumeArchiveRoot, uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { buildResumeSharePointPath } from "@/lib/integrations/sharepointResumeNaming";
import { sha256Hex } from "@/lib/sha256";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";

export interface ArchiveResumeToSharePointParams {
  applicationId: string;
  resumeVersionId: string;
  exportType: "pdf" | "docx";
  candidateId: string;
  candidateName: string | null | undefined;
  companyName: string | null | undefined;
  jobTitle: string | null | undefined;
  jobId: string | null | undefined;
  buffer: Uint8Array;
  createdByUserId?: string | null;
  variantLabel?: string | null;
  preferExistingFolder?: boolean;
}

export interface ArchiveResumeToSharePointResult {
  ok: boolean;
  id?: string;
  url?: string;
  storageItemId?: string | null;
  duplicate?: boolean;
  error?: string;
}

function resumePathInput(params: ArchiveResumeToSharePointParams) {
  return {
    candidateId: params.candidateId,
    candidateName: params.candidateName,
    jobId: params.jobId,
    companyName: params.companyName,
    jobTitle: params.jobTitle,
    resumeVersionId: params.resumeVersionId,
    variantLabel: params.variantLabel,
  };
}

export async function uploadVerifiedResumeArchive(params: ArchiveResumeToSharePointParams, expectedHash: string) {
  const destination = buildResumeSharePointPath({ ...resumePathInput(params), archiveRoot: await sharePointResumeArchiveRoot() });
  const uploaded = await uploadToSharePoint(destination.path, params.buffer, "application/pdf", { preferExistingFolder: true });
  if (!uploaded.itemId || !uploaded.url) throw new Error("SharePoint did not return an archive reference.");
  const bytes = new Uint8Array(await (await openSharePointItem(uploaded.itemId)).arrayBuffer());
  if (bytes.byteLength !== params.buffer.byteLength || await sha256Hex(bytes) !== expectedHash) {
    throw new Error("SharePoint PDF checksum does not match approval.");
  }
  return { ...destination, ...uploaded };
}

export async function archiveResumeToSharePoint(params: ArchiveResumeToSharePointParams): Promise<ArchiveResumeToSharePointResult> {
  const naming = resumePathInput(params);
  let { path, fileName } = buildResumeSharePointPath(naming);
  const contentType =
    params.exportType === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const contentHash = await sha256Hex(params.buffer);

  // One archive slot per application/resume-version/export/filename: normal
  // (non-variant) archives reuse the same filename and overwrite the current
  // SharePoint file; a content-identical re-archive is a no-op.
  const lookup = (firstName: string, secondName: string) => queryOne<{
    id: string;
    status: string;
    storage_url: string | null;
    storage_item_id: string | null;
    content_sha256: string | null;
    storage_provider: string | null;
  }>(
    `SELECT id, status, storage_url, storage_item_id, content_sha256, storage_provider FROM application_resume_exports
     WHERE application_id = $1 AND resume_version_id = $2 AND export_type = $3
       AND (content_sha256 = $5 OR ($7::boolean AND file_name IN ($4, $6)))
       AND status <> 'deleted'
       ORDER BY (content_sha256 IS NOT DISTINCT FROM $5) DESC, created_at DESC LIMIT 1`,
    [params.applicationId, params.resumeVersionId, params.exportType, firstName, contentHash, secondName, !params.variantLabel]
  );
  const originalName = fileName;
  let existing = await lookup(originalName, originalName);
  if (params.preferExistingFolder && existing?.status === "created" && existing.storage_provider === TEMPORARY_RESUME_PDF_PROVIDER
    && existing.content_sha256 === contentHash) return { ok: true, id: existing.id, duplicate: true };
  if (existing?.status === "created" && existing.storage_url && existing.content_sha256 === contentHash) {
    return { ok: true, id: existing.id, url: existing.storage_url, storageItemId: existing.storage_item_id, duplicate: true };
  }

  try {
    ({ path, fileName } = buildResumeSharePointPath({ ...naming, archiveRoot: await sharePointResumeArchiveRoot() }));
    if (!existing && originalName !== fileName && !params.variantLabel) existing = await lookup(originalName, fileName);
    if (existing?.status === "created" && existing.storage_url && existing.content_sha256 === contentHash) {
      return { ok: true, id: existing.id, url: existing.storage_url, storageItemId: existing.storage_item_id, duplicate: true };
    }
    const sp = params.preferExistingFolder && params.exportType === "pdf"
      ? await uploadVerifiedResumeArchive(params, contentHash)
      : await uploadToSharePoint(path, params.buffer, contentType, params.preferExistingFolder ? { preferExistingFolder: true } : undefined);
    const rows = existing
      ? await query<{ id: string }>(
          `UPDATE application_resume_exports SET file_name = $1, file_path = $2, storage_provider = $3,
             storage_url = $4, storage_item_id = $5, file_size_bytes = $6, status = 'created', error = NULL,
             content_sha256 = $7, candidate_name_snapshot = $8, company_name_snapshot = $9, job_title_snapshot = $10,
             created_by = $11, updated_at = NOW() WHERE id = $12 RETURNING id`,
          [
            fileName, path, "sharepoint", sp.url, sp.itemId ?? null, params.buffer.byteLength, contentHash,
            params.candidateName ?? null, params.companyName ?? null, params.jobTitle ?? null,
            params.createdByUserId ?? null, existing.id,
          ]
        )
      : await query<{ id: string }>(
          `INSERT INTO application_resume_exports
             (application_id, resume_version_id, export_type, file_name, file_path, storage_provider, storage_url,
              storage_item_id, file_size_bytes, status, created_by, content_sha256,
              candidate_name_snapshot, company_name_snapshot, job_title_snapshot, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'created',$10,$11,$12,$13,$14,NOW())
           ON CONFLICT (application_id,resume_version_id,export_type,content_sha256)
             WHERE content_sha256 IS NOT NULL AND status <> 'deleted'
           DO UPDATE SET file_name=EXCLUDED.file_name,file_path=EXCLUDED.file_path,storage_provider=EXCLUDED.storage_provider,
             storage_url=EXCLUDED.storage_url,storage_item_id=EXCLUDED.storage_item_id,file_size_bytes=EXCLUDED.file_size_bytes,
             status='created',error=NULL,updated_at=NOW()
             WHERE application_resume_exports.status <> 'created'
           RETURNING id`,
          [
            params.applicationId, params.resumeVersionId, params.exportType, fileName, path, "sharepoint", sp.url,
            sp.itemId ?? null, params.buffer.byteLength, params.createdByUserId ?? null, contentHash,
            params.candidateName ?? null, params.companyName ?? null, params.jobTitle ?? null,
          ]
        );
    if (rows[0]) return { ok: true, id: rows[0].id, url: sp.url, storageItemId: sp.itemId ?? null };
    const concurrent = await lookup(fileName, fileName);
    if (concurrent?.status === "created" && concurrent.storage_url && concurrent.content_sha256 === contentHash) {
      return { ok: true, id: concurrent.id, url: concurrent.storage_url, storageItemId: concurrent.storage_item_id, duplicate: true };
    }
    return { ok: false, error: "The archive reference is still being recorded. Please retry." };
  } catch (err: any) {
    const errorMsg = err?.message ?? String(err);
    if (existing) {
      await query(
        `UPDATE application_resume_exports
         SET status = 'failed', error = $1, content_sha256 = $2, file_size_bytes = $3, created_by = $4, updated_at = NOW()
         WHERE id = $5 AND status <> 'created'`,
        [errorMsg, contentHash, params.buffer.byteLength, params.createdByUserId ?? null, existing.id]
      );
    } else {
      await query(
        `INSERT INTO application_resume_exports
           (application_id, resume_version_id, export_type, file_name, file_path, status, error, created_by,
            content_sha256, candidate_name_snapshot, company_name_snapshot, job_title_snapshot, updated_at)
         VALUES ($1,$2,$3,$4,$5,'failed',$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (application_id, resume_version_id, export_type, content_sha256)
           WHERE content_sha256 IS NOT NULL AND status <> 'deleted'
           DO UPDATE SET status = 'failed', error = EXCLUDED.error, updated_at = NOW(), created_by = EXCLUDED.created_by
             WHERE application_resume_exports.status <> 'created'`,
        [
          params.applicationId, params.resumeVersionId, params.exportType, fileName, path, errorMsg,
          params.createdByUserId ?? null, contentHash, params.candidateName ?? null, params.companyName ?? null,
          params.jobTitle ?? null,
        ]
      );
    }
    return { ok: false, error: errorMsg };
  }
}
