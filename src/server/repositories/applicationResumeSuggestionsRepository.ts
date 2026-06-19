// src/server/repositories/applicationResumeSuggestionsRepository.ts
// Data-access abstraction for application_resume_suggestions table.
// Implementation uses Supabase today; interface designed for portability.

import { supabase } from "@/lib/supabase";

export type SuggestionType =
  | "content_change"
  | "format_improvement"
  | "truth_warning"
  | "keyword_injection"
  | "missing_evidence";

export type SuggestionTargetSection =
  | "summary"
  | "skills"
  | "experience"
  | "education"
  | "certifications"
  | "projects"
  | "header";

export type SuggestionTruthStatus = "verified" | "unverified" | "fabrication_risk";
export type SuggestionStatus = "pending" | "accepted" | "rejected" | "applied";

export interface ApplicationResumeSuggestionRow {
  id: string;
  application_id: string;
  resume_version_id: string | null;
  keyword_id: string | null;
  suggestion_type: SuggestionType;
  target_section: SuggestionTargetSection;
  target_subsection_id: string | null;
  original_text: string | null;
  proposed_text: string;
  ai_reasoning: string | null;
  truth_status: SuggestionTruthStatus;
  truth_check_details: string | null;
  source_evidence: string | null;
  status: SuggestionStatus;
  user_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateSuggestionInput {
  application_id: string;
  resume_version_id?: string | null;
  keyword_id?: string | null;
  suggestion_type: SuggestionType;
  target_section: SuggestionTargetSection;
  target_subsection_id?: string | null;
  original_text?: string | null;
  proposed_text: string;
  ai_reasoning?: string | null;
  truth_status?: SuggestionTruthStatus;
  truth_check_details?: string | null;
  source_evidence?: string | null;
  status?: SuggestionStatus;
  user_notes?: string | null;
}

export interface UpdateSuggestionInput {
  status?: SuggestionStatus;
  user_notes?: string | null;
  truth_status?: SuggestionTruthStatus;
  truth_check_details?: string | null;
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────

export async function findSuggestionById(
  id: string
): Promise<ApplicationResumeSuggestionRow | null> {
  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ApplicationResumeSuggestionRow;
}

export async function listSuggestionsByApplication(
  applicationId: string
): Promise<ApplicationResumeSuggestionRow[]> {
  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeSuggestionRow[];
}

export async function listSuggestionsByApplicationAndStatus(
  applicationId: string,
  status: SuggestionStatus
): Promise<ApplicationResumeSuggestionRow[]> {
  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .select("*")
    .eq("application_id", applicationId)
    .eq("status", status)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeSuggestionRow[];
}

export async function createSuggestion(
  input: CreateSuggestionInput
): Promise<ApplicationResumeSuggestionRow> {
  const row = {
    application_id: input.application_id,
    resume_version_id: input.resume_version_id ?? null,
    keyword_id: input.keyword_id ?? null,
    suggestion_type: input.suggestion_type,
    target_section: input.target_section,
    target_subsection_id: input.target_subsection_id ?? null,
    original_text: input.original_text ?? null,
    proposed_text: input.proposed_text,
    ai_reasoning: input.ai_reasoning ?? null,
    truth_status: input.truth_status ?? "unverified",
    truth_check_details: input.truth_check_details ?? null,
    source_evidence: input.source_evidence ?? null,
    status: input.status ?? "pending",
    user_notes: input.user_notes ?? null,
  };

  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeSuggestionRow;
}

export async function createManySuggestions(
  inputs: CreateSuggestionInput[]
): Promise<ApplicationResumeSuggestionRow[]> {
  if (inputs.length === 0) return [];

  const rows = inputs.map((input) => ({
    application_id: input.application_id,
    resume_version_id: input.resume_version_id ?? null,
    keyword_id: input.keyword_id ?? null,
    suggestion_type: input.suggestion_type,
    target_section: input.target_section,
    target_subsection_id: input.target_subsection_id ?? null,
    original_text: input.original_text ?? null,
    proposed_text: input.proposed_text,
    ai_reasoning: input.ai_reasoning ?? null,
    truth_status: input.truth_status ?? "unverified",
    truth_check_details: input.truth_check_details ?? null,
    source_evidence: input.source_evidence ?? null,
    status: input.status ?? "pending",
    user_notes: input.user_notes ?? null,
  }));

  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationResumeSuggestionRow[];
}

export async function updateSuggestion(
  id: string,
  input: UpdateSuggestionInput
): Promise<ApplicationResumeSuggestionRow> {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationResumeSuggestionRow;
}

export async function deleteSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from("application_resume_suggestions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSuggestionsByApplicationId(
  applicationId: string
): Promise<void> {
  const { error } = await supabase
    .from("application_resume_suggestions")
    .delete()
    .eq("application_id", applicationId);
  if (error) throw new Error(error.message);
}

// ───────────────────────────────────────────────────────────────
// Stats / helpers
// ───────────────────────────────────────────────────────────────

export interface SuggestionStats {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  verified: number;
  unverified: number;
  fabricationRisk: number;
}

export async function getSuggestionStats(
  applicationId: string
): Promise<SuggestionStats> {
  const { data, error } = await supabase
    .from("application_resume_suggestions")
    .select("status, truth_status")
    .eq("application_id", applicationId);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { status: SuggestionStatus; truth_status: SuggestionTruthStatus }[];
  return {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    accepted: rows.filter((r) => r.status === "accepted").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    applied: rows.filter((r) => r.status === "applied").length,
    verified: rows.filter((r) => r.truth_status === "verified").length,
    unverified: rows.filter((r) => r.truth_status === "unverified").length,
    fabricationRisk: rows.filter((r) => r.truth_status === "fabrication_risk").length,
  };
}

export function groupSuggestionsBySection(
  suggestions: ApplicationResumeSuggestionRow[]
): Record<SuggestionTargetSection, ApplicationResumeSuggestionRow[]> {
  const groups: Record<string, ApplicationResumeSuggestionRow[]> = {
    summary: [],
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    projects: [],
    header: [],
  };
  for (const s of suggestions) {
    if (!groups[s.target_section]) groups[s.target_section] = [];
    groups[s.target_section].push(s);
  }
  return groups as Record<SuggestionTargetSection, ApplicationResumeSuggestionRow[]>;
}

export function groupSuggestionsByStatus(
  suggestions: ApplicationResumeSuggestionRow[]
): Record<SuggestionStatus, ApplicationResumeSuggestionRow[]> {
  const groups: Record<string, ApplicationResumeSuggestionRow[]> = {
    pending: [],
    accepted: [],
    rejected: [],
    applied: [],
  };
  for (const s of suggestions) {
    if (!groups[s.status]) groups[s.status] = [];
    groups[s.status].push(s);
  }
  return groups as Record<SuggestionStatus, ApplicationResumeSuggestionRow[]>;
}
