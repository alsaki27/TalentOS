import { openSharePointItem, downloadFromSharePoint } from "@/lib/integrations/sharepoint";
import { sha256Hex } from "@/lib/sha256";
import { findExportById, type ApplicationResumeExportRow } from "@/server/repositories/applicationResumeExportsRepository";
import {
  readTemporaryResumePdf, StagedResumePdfMissingError, TEMPORARY_RESUME_PDF_PROVIDER,
} from "@/server/storage/approvedResumePdfStorage";

export async function readApprovedResumePdf(record: ApplicationResumeExportRow): Promise<Uint8Array> {
  const hash = record.content_sha256;
  if (record.export_type !== "pdf" || record.status !== "created" || !hash) {
    throw new Error("The approved résumé PDF is unavailable.");
  }
  if (record.storage_provider === TEMPORARY_RESUME_PDF_PROVIDER && record.file_path) {
    try {
      return await readTemporaryResumePdf(record.file_path, hash);
    } catch (error) {
      if (!(error instanceof StagedResumePdfMissingError)) throw error;
      const current = await findExportById(record.id);
      if (!current || current.storage_provider !== "sharepoint" || current.content_sha256 !== hash
        || current.application_id !== record.application_id || current.resume_version_id !== record.resume_version_id) throw error;
      record = current;
    }
  }
  if (record.storage_provider !== "sharepoint" || !record.storage_url) throw new Error("The approved résumé PDF is unavailable.");
  const bytes = record.storage_item_id
    ? new Uint8Array(await (await openSharePointItem(record.storage_item_id)).arrayBuffer())
    : new Uint8Array((await downloadFromSharePoint(record.storage_url)).buffer);
  if (await sha256Hex(bytes) !== hash) throw new Error("The archived PDF checksum does not match approval.");
  return bytes;
}
