// src/server/repositories/applicationResumeVersionsRepository.ts
// Data-access abstraction for application_resume_versions table.
// Implementation uses Supabase today; interface designed for portability.

import { supabase } from "@/lib/supabase";

export type ResumeVersionStatus = "draft" | "in_review" | "approved" | "archived";
export type ResumeVersionSourceType = "base_resume" | "original_resume" | "blank" | "manual";

export interface ApplicationResumeVersionRow {
  id: string;
  candidate_id: string;
  base_resume_id: string | null;
  target_job_id: string;
  content: Record<string, unknown>;
  formatting: Record<string, unknown> | null;
  ats_score: number | null;
  truth_score: number | null;
  one_page_fit_score: number | null;
  status: ResumeVersionStatus;
  source_type: ResumeVersionSourceType;
  title: string | null;
  version_label: string | null;
  generated_text: string | null;
  source_resume_id: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateApplicationResumeVersionInput {
  candidate_id: string;
  base_resume_id?: string | null;
  target_job_id: string;
  content: Record<string, unknown>;
  formatting?: Record<string, unknown> | null;
  status?: ResumeVersionStatus;
  source_type?: ResumeVersionSourceType;
  title?: string | null;
  version_label?: string | null;
  generated_text?: string | null;
  source_resume_id?: string | null;
  created_by?: string | null;
}

export interface UpdateApplicationResumeVersionInput {
  content?: Record<string, unknown>;
  formatting?: Record<string, unknown> | null;
  status?: ResumeVersionStatus;
  ats_score?: number | null;
  truth_score?: number | null;
  one_page_fit_score?: number | null;
  title?: string | null;
  version_label?: string | null;
  generated_text?: string | null;
  source_resume_id?: string | null;
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────

export async function findResumeVersionById(
  id: string
): Promise<ApplicationResumeVersionRow | null> {
  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ApplicationResumeVersionRow;
}

export async function listResumeVersionsByCandidate(
  candidateId: string
): Promise<ApplicationResumeVersionRow[]> {
  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeVersionRow[];
}

export async function listResumeVersionsByApplication(
  candidateId: string,
  targetJobId: string
): Promise<ApplicationResumeVersionRow[]> {
  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at")
    .eq("candidate_id", candidateId)
    .eq("target_job_id", targetJobId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeVersionRow[];
}

export async function createApplicationResumeVersion(
  input: CreateApplicationResumeVersionInput
): Promise<ApplicationResumeVersionRow> {
  const row: Record<string, unknown> = {
    candidate_id: input.candidate_id,
    base_resume_id: input.base_resume_id ?? null,
    target_job_id: input.target_job_id,
    content: input.content,
    formatting: input.formatting ?? null,
    status: input.status ?? "draft",
    source_type: input.source_type ?? "base_resume",
    title: input.title ?? null,
    version_label: input.version_label ?? null,
    generated_text: input.generated_text ?? null,
    source_resume_id: input.source_resume_id ?? null,
    created_by: input.created_by ?? null,
  };
  const { data, error } = await supabase
    .from("application_resume_versions")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeVersionRow;
}

export async function updateApplicationResumeVersion(
  id: string,
  input: UpdateApplicationResumeVersionInput
): Promise<ApplicationResumeVersionRow> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) updates[key] = value;
  }
  if (Object.keys(updates).length === 1) { // only updated_at
    throw new Error("No fields to update");
  }
  const { data, error } = await supabase
    .from("application_resume_versions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeVersionRow;
}

export async function deleteResumeVersion(id: string): Promise<void> {
  const { error } = await supabase
    .from("application_resume_versions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ───────────────────────────────────────────────────────────────
// Draft helpers
// ───────────────────────────────────────────────────────────────

export async function getCurrentDraftForApplication(
  candidateId: string,
  targetJobId: string
): Promise<ApplicationResumeVersionRow | null> {
  const { data, error } = await supabase
    .from("application_resume_versions")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("target_job_id", targetJobId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeVersionRow | null;
}

export async function cloneResumeVersion(
  sourceId: string,
  overrides: Partial<CreateApplicationResumeVersionInput>
): Promise<ApplicationResumeVersionRow> {
  const source = await findResumeVersionById(sourceId);
  if (!source) throw new Error("Source resume version not found");

  const row: Record<string, unknown> = {
    candidate_id: overrides.candidate_id ?? source.candidate_id,
    base_resume_id: overrides.base_resume_id ?? source.base_resume_id,
    target_job_id: overrides.target_job_id ?? source.target_job_id,
    content: overrides.content ?? structuredClone(source.content),
    formatting: overrides.formatting ?? source.formatting,
    status: overrides.status ?? "draft",
    source_type: overrides.source_type ?? source.source_type,
    title: overrides.title ?? `${source.title ?? "Draft"} (copy)`,
    version_label: overrides.version_label ?? "draft",
    generated_text: overrides.generated_text ?? source.generated_text,
    source_resume_id: overrides.source_resume_id ?? source.source_resume_id,
    created_by: overrides.created_by ?? null,
  };

  const { data, error } = await supabase
    .from("application_resume_versions")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeVersionRow;
}

export async function markResumeVersionAsDraft(id: string): Promise<ApplicationResumeVersionRow> {
  return updateApplicationResumeVersion(id, { status: "draft" });
}

export async function markResumeVersionAsFinal(id: string): Promise<ApplicationResumeVersionRow> {
  return updateApplicationResumeVersion(id, { status: "approved" });
}

// ───────────────────────────────────────────────────────────────
// Packet attachment
// ───────────────────────────────────────────────────────────────

export async function attachResumeVersionToPacket(
  applicationId: string,
  resumeVersionId: string
): Promise<void> {
  const { error } = await supabase
    .from("application_packets")
    .update({ final_resume_version_id: resumeVersionId, updated_at: new Date().toISOString() })
    .eq("application_id", applicationId);
  if (error) throw new Error(error.message);
}

export async function getPacketForApplication(
  applicationId: string
): Promise<{ application_id: string; final_resume_version_id: string | null } | null> {
  const { data, error } = await supabase
    .from("application_packets")
    .select("application_id, final_resume_version_id")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { application_id: string; final_resume_version_id: string | null };
}

export async function createOrUpdatePacket(
  applicationId: string,
  resumeVersionId: string
): Promise<void> {
  const existing = await getPacketForApplication(applicationId);
  if (existing) {
    await attachResumeVersionToPacket(applicationId, resumeVersionId);
  } else {
    const { error } = await supabase
      .from("application_packets")
      .insert({
        application_id: applicationId,
        final_resume_version_id: resumeVersionId,
      });
    if (error) throw new Error(error.message);
  }
}
