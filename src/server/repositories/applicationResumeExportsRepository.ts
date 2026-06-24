// src/server/repositories/applicationResumeExportsRepository.ts
// Data-access abstraction for application_resume_exports table.
// Implementation supports both Supabase and Neon backends.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
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
  if (isNeon()) {
    const row = await queryOne<ApplicationResumeExportRow>(
      `SELECT * FROM application_resume_exports WHERE id = $1`,
      [id]
    );
    return row ?? null;
  } else {
    const { data, error } = await supabase
      .from("application_resume_exports")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as ApplicationResumeExportRow;
  }
}

export async function listExportsByApplication(applicationId: string): Promise<ApplicationResumeExportRow[]> {
  if (isNeon()) {
    return query<ApplicationResumeExportRow>(
      `SELECT * FROM application_resume_exports WHERE application_id = $1 ORDER BY created_at DESC`,
      [applicationId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_resume_exports")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeExportRow[];
  }
}

export async function listExportsByResumeVersion(resumeVersionId: string): Promise<ApplicationResumeExportRow[]> {
  if (isNeon()) {
    return query<ApplicationResumeExportRow>(
      `SELECT * FROM application_resume_exports WHERE resume_version_id = $1 ORDER BY created_at DESC`,
      [resumeVersionId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_resume_exports")
      .select("*")
      .eq("resume_version_id", resumeVersionId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeExportRow[];
  }
}

export async function createExport(input: CreateExportInput): Promise<ApplicationResumeExportRow> {
  if (isNeon()) {
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
  } else {
    const row = {
      application_id: input.application_id,
      resume_version_id: input.resume_version_id,
      export_type: input.export_type,
      file_name: input.file_name,
      file_path: input.file_path ?? null,
      storage_provider: input.storage_provider ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      status: input.status ?? "created",
      created_by: input.created_by ?? null,
    };
    const { data, error } = await supabase
      .from("application_resume_exports")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationResumeExportRow;
  }
}

export async function markExportFailed(id: string, errorMsg: string): Promise<ApplicationResumeExportRow> {
  if (isNeon()) {
    const result = await queryOne<ApplicationResumeExportRow>(
      `UPDATE application_resume_exports SET status = 'failed', error = $2 WHERE id = $1 RETURNING *`,
      [id, errorMsg]
    );
    if (!result) throw new Error("Update failed");
    return result;
  } else {
    const { data, error } = await supabase
      .from("application_resume_exports")
      .update({ status: "failed", error: errorMsg })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationResumeExportRow;
  }
}

export async function markExportDeleted(id: string): Promise<void> {
  if (isNeon()) {
    await execute(
      `UPDATE application_resume_exports SET status = 'deleted' WHERE id = $1`,
      [id]
    );
    return;
  } else {
    const { error } = await supabase
      .from("application_resume_exports")
      .update({ status: "deleted" })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
}

export async function deleteExportRecord(id: string): Promise<void> {
  if (isNeon()) {
    await execute(
      `DELETE FROM application_resume_exports WHERE id = $1`,
      [id]
    );
    return;
  } else {
    const { error } = await supabase
      .from("application_resume_exports")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
}
