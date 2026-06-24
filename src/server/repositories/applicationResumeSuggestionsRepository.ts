// src/server/repositories/applicationResumeSuggestionsRepository.ts
// Data-access abstraction for application_resume_suggestions table.
// Implementation supports both Supabase and Neon backends.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db/index";
import { query, queryOne, execute } from "@/server/db/neon";

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
  if (isNeon()) {
    const row = await queryOne<ApplicationResumeSuggestionRow>(
      "SELECT * FROM application_resume_suggestions WHERE id = $1",
      [id]
    );
    return row;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as ApplicationResumeSuggestionRow;
  }
}

export async function listSuggestionsByApplication(
  applicationId: string
): Promise<ApplicationResumeSuggestionRow[]> {
  if (isNeon()) {
    const rows = await query<ApplicationResumeSuggestionRow>(
      "SELECT * FROM application_resume_suggestions WHERE application_id = $1 ORDER BY created_at ASC",
      [applicationId]
    );
    return rows;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeSuggestionRow[];
  }
}

export async function listSuggestionsByApplicationAndStatus(
  applicationId: string,
  status: SuggestionStatus
): Promise<ApplicationResumeSuggestionRow[]> {
  if (isNeon()) {
    const rows = await query<ApplicationResumeSuggestionRow>(
      "SELECT * FROM application_resume_suggestions WHERE application_id = $1 AND status = $2 ORDER BY created_at ASC",
      [applicationId, status]
    );
    return rows;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .select("*")
      .eq("application_id", applicationId)
      .eq("status", status)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeSuggestionRow[];
  }
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

  if (isNeon()) {
    const created = await queryOne<ApplicationResumeSuggestionRow>(
      `INSERT INTO application_resume_suggestions (
        application_id, resume_version_id, keyword_id, suggestion_type,
        target_section, target_subsection_id, original_text, proposed_text,
        ai_reasoning, truth_status, truth_check_details, source_evidence,
        status, user_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        row.application_id,
        row.resume_version_id,
        row.keyword_id,
        row.suggestion_type,
        row.target_section,
        row.target_subsection_id,
        row.original_text,
        row.proposed_text,
        row.ai_reasoning,
        row.truth_status,
        row.truth_check_details,
        row.source_evidence,
        row.status,
        row.user_notes,
      ]
    );
    if (!created) throw new Error("Failed to create suggestion");
    return created;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationResumeSuggestionRow;
  }
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

  if (isNeon()) {
    const columns = [
      "application_id",
      "resume_version_id",
      "keyword_id",
      "suggestion_type",
      "target_section",
      "target_subsection_id",
      "original_text",
      "proposed_text",
      "ai_reasoning",
      "truth_status",
      "truth_check_details",
      "source_evidence",
      "status",
      "user_notes",
    ];
    const values: (string | number | boolean | object | Date | null)[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;
    for (const r of rows) {
      const rowPlaceholders: string[] = [];
      for (let i = 0; i < columns.length; i++) {
        rowPlaceholders.push(`$${paramIndex++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(
        r.application_id,
        r.resume_version_id,
        r.keyword_id,
        r.suggestion_type,
        r.target_section,
        r.target_subsection_id,
        r.original_text,
        r.proposed_text,
        r.ai_reasoning,
        r.truth_status,
        r.truth_check_details,
        r.source_evidence,
        r.status,
        r.user_notes
      );
    }
    const sql = `INSERT INTO application_resume_suggestions (${columns.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
    const created = await query<ApplicationResumeSuggestionRow>(sql, values);
    return created;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .insert(rows)
      .select();
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeSuggestionRow[];
  }
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

  if (isNeon()) {
    const setFields = Object.keys(updates);
    const values = setFields.map((k) => updates[k]) as (string | number | boolean | object | Date | null)[];
    const setClause = setFields.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const sql = `UPDATE application_resume_suggestions SET ${setClause} WHERE id = $${setFields.length + 1} RETURNING *`;
    values.push(id);
    const updated = await queryOne<ApplicationResumeSuggestionRow>(sql, values);
    if (!updated) throw new Error("Failed to update suggestion");
    return updated;
  } else {
    const { data, error } = await supabase
      .from("application_resume_suggestions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationResumeSuggestionRow;
  }
}

export async function deleteSuggestion(id: string): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM application_resume_suggestions WHERE id = $1", [id]);
  } else {
    const { error } = await supabase
      .from("application_resume_suggestions")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
}

export async function deleteSuggestionsByApplicationId(
  applicationId: string
): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM application_resume_suggestions WHERE application_id = $1", [applicationId]);
  } else {
    const { error } = await supabase
      .from("application_resume_suggestions")
      .delete()
      .eq("application_id", applicationId);
    if (error) throw new Error(error.message);
  }
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
  if (isNeon()) {
    const rows = await query<{ status: SuggestionStatus; truth_status: SuggestionTruthStatus }>(
      "SELECT status, truth_status FROM application_resume_suggestions WHERE application_id = $1",
      [applicationId]
    );
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
  } else {
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
