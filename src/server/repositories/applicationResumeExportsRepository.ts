// src/server/repositories/applicationResumeExportsRepository.ts
// Data-access abstraction for application_resume_exports table.

import { supabase } from "@/lib/supabase";

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
  const { data, error } = await supabase
    .from("application_resume_exports")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ApplicationResumeExportRow;
}

export async function listExportsByApplication(applicationId: string): Promise<ApplicationResumeExportRow[]> {
  const { data, error } = await supabase
    .from("application_resume_exports")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeExportRow[];
}

export async function listExportsByResumeVersion(resumeVersionId: string): Promise<ApplicationResumeExportRow[]> {
  const { data, error } = await supabase
    .from("application_resume_exports")
    .select("*")
    .eq("resume_version_id", resumeVersionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeExportRow[];
}

export async function createExport(input: CreateExportInput): Promise<ApplicationResumeExportRow> {
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

export async function markExportFailed(id: string, errorMsg: string): Promise<ApplicationResumeExportRow> {
  const { data, error } = await supabase
    .from("application_resume_exports")
    .update({ status: "failed", error: errorMsg })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeExportRow;
}

export async function markExportDeleted(id: string): Promise<void> {
  const { error } = await supabase
    .from("application_resume_exports")
    .update({ status: "deleted" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteExportRecord(id: string): Promise<void> {
  const { error } = await supabase
    .from("application_resume_exports")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
