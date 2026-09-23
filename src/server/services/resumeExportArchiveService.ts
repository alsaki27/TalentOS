import { queryOne } from "@/server/db/neon";
import { downloadResumeFile } from "@/lib/resumeStorage";

export interface ArchivedPdf {
  id: string;
  application_id: string;
  resume_version_id: string;
  file_name: string;
  file_path: string;
  storage_provider: string | null;
  storage_url: string | null;
}

export async function findLatestArchivedPdf(applicationId: string, candidateId?: string) {
  return queryOne<ArchivedPdf>(
    `SELECT e.id, e.application_id, e.resume_version_id, e.file_name, e.file_path,
            e.storage_provider, e.storage_url
     FROM application_resume_exports e
     JOIN applications a ON a.id = e.application_id
     WHERE e.application_id = $1 AND e.export_type = 'pdf' AND e.status = 'created'
       AND e.file_path IS NOT NULL
       ${candidateId ? "AND a.candidate_id = $2" : ""}
     ORDER BY COALESCE(e.updated_at, e.created_at) DESC LIMIT 1`,
    candidateId ? [applicationId, candidateId] : [applicationId]
  );
}

export async function archivedPdfResponse(record: ArchivedPdf) {
  const file = await downloadResumeFile(record.storage_provider, record.file_path, record.storage_url);
  const safeName = record.file_name.replace(/["\r\n]/g, "_");
  return new Response(new Blob([new Uint8Array(file.buffer)]), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
