// src/server/repositories/applicationResumeExportsRepository.ts
// Data-access abstraction for application_resume_exports table.

import { query, queryOne, execute } from "@/server/db/neon";

export type ExportType = "docx" | "pdf" | "markdown" | "text";
export type ExportStatus = "created" | "failed" | "deleted";

export interface ApplicationResumeExportRow {
  id: string;
  application_id: string;
  resume_version_id: string;
  export_type: ExportType;
  file_name: string;
  file_path: string | null;
  storage_provider: string | null;
  storage_url: string | null;
  storage_item_id: string | null;
  file_size_bytes: number | null;
  status: ExportStatus;
  error: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface CreateExportInput {
  application_id: string;
  resume_version_id: string;
  export_type: ExportType;
  file_name: string;
  file_path?: string | null;
  storage_provider?: string | null;
  file_size_bytes?: number | null;
  status?: ExportStatus;
  created_by?: string | null;
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────

export async function findExportById(id: string): Promise<ApplicationResumeExportRow | null> {
  const row = await queryOne<ApplicationResumeExportRow>(
    `SELECT * FROM application_resume_exports WHERE id = $1`,
    [id]
  );
  return row ?? null;
}

export async function listExportsByApplication(applicationId: string): Promise<ApplicationResumeExportRow[]> {
  return query<ApplicationResumeExportRow>(
    `SELECT * FROM application_resume_exports WHERE application_id = $1 ORDER BY created_at DESC`,
    [applicationId]
  );
}

export async function listExportsByResumeVersion(resumeVersionId: string): Promise<ApplicationResumeExportRow[]> {
  return query<ApplicationResumeExportRow>(
    `SELECT * FROM application_resume_exports WHERE resume_version_id = $1 ORDER BY created_at DESC`,
    [resumeVersionId]
  );
}

export async function createExport(input: CreateExportInput): Promise<ApplicationResumeExportRow> {
  const sql = `
    INSERT INTO application_resume_exports (
      application_id, resume_version_id, export_type, file_name,
      file_path, storage_provider, file_size_bytes, status, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;
  const result = await queryOne<ApplicationResumeExportRow>(sql, [
    input.application_id,
    input.resume_version_id,
    input.export_type,
    input.file_name,
    input.file_path ?? null,
    input.storage_provider ?? null,
    input.file_size_bytes ?? null,
    input.status ?? "created",
    input.created_by ?? null,
  ]);
  if (!result) throw new Error("Failed to create export");
  return result;
}

export async function markExportFailed(id: string, errorMsg: string): Promise<ApplicationResumeExportRow> {
  const result = await queryOne<ApplicationResumeExportRow>(
    `UPDATE application_resume_exports SET status = 'failed', error = $2 WHERE id = $1 RETURNING *`,
    [id, errorMsg]
  );
  if (!result) throw new Error("Update failed");
  return result;
}

export async function markExportDeleted(id: string): Promise<void> {
  await execute(
    `UPDATE application_resume_exports SET status = 'deleted' WHERE id = $1`,
    [id]
  );
}

export async function deleteExportRecord(id: string): Promise<void> {
  await execute(
    `DELETE FROM application_resume_exports WHERE id = $1`,
    [id]
  );
}
