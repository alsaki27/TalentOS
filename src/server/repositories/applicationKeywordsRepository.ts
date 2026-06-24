// src/server/repositories/applicationKeywordsRepository.ts
// Data-access abstraction for application_job_keywords table.
// Implementation supports both Supabase and Neon backends.
// Rule: no new direct supabase.from() calls in new feature routes.

import { supabase } from "@/lib/supabase";
import { isNeon, query, queryOne, execute } from "@/server/db";

export type ApplicationKeywordCategory =
  | "skill"
  | "tool"
  | "responsibility"
  | "certification"
  | "education"
  | "experience"
  | "domain"
  | "soft_skill"
  | "visa"
  | "red_flag"
  | "other";

export type ApplicationKeywordImportance = "low" | "medium" | "high" | "critical";
export type ApplicationKeywordSource = "ai_jd_analysis" | "manual" | "imported";
export type ApplicationKeywordStatus = "pending" | "approved" | "rejected" | "needs_evidence";
export type ApplicationKeywordEvidenceStatus = "unmapped" | "mapped" | "weak" | "missing";

export interface ApplicationKeywordRow {
  id: string;
  application_id: string;
  job_id: string | null;
  keyword: string;
  normalized_keyword: string;
  category: ApplicationKeywordCategory;
  importance: ApplicationKeywordImportance;
  source: ApplicationKeywordSource;
  status: ApplicationKeywordStatus;
  ai_reason: string | null;
  user_reason: string | null;
  evidence_summary: string | null;
  evidence_status: ApplicationKeywordEvidenceStatus;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface UpsertApplicationKeywordInput {
  application_id: string;
  job_id?: string | null;
  keyword: string;
  normalized_keyword: string;
  category: ApplicationKeywordCategory;
  importance?: ApplicationKeywordImportance;
  source?: ApplicationKeywordSource;
  status?: ApplicationKeywordStatus;
  ai_reason?: string | null;
  evidence_summary?: string | null;
  evidence_status?: ApplicationKeywordEvidenceStatus;
  created_by?: string | null;
}

export interface UpdateApplicationKeywordInput {
  status?: ApplicationKeywordStatus;
  user_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  evidence_summary?: string | null;
  evidence_status?: ApplicationKeywordEvidenceStatus;
  ai_reason?: string | null;
}

export interface BulkUpdateInput {
  id: string;
  status: ApplicationKeywordStatus;
  user_reason?: string | null;
  reviewed_by?: string | null;
  evidence_summary?: string | null;
  evidence_status?: ApplicationKeywordEvidenceStatus;
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────

export async function findApplicationKeywordById(
  id: string
): Promise<ApplicationKeywordRow | null> {
  if (isNeon()) {
    return await queryOne<ApplicationKeywordRow>(
      "SELECT * FROM application_job_keywords WHERE id = $1 LIMIT 1",
      [id]
    );
  } else {
    const { data, error } = await supabase
      .from("application_job_keywords")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as ApplicationKeywordRow;
  }
}

export async function listApplicationKeywords(
  applicationId: string
): Promise<ApplicationKeywordRow[]> {
  if (isNeon()) {
    return await query<ApplicationKeywordRow>(
      "SELECT * FROM application_job_keywords WHERE application_id = $1 ORDER BY importance DESC, created_at ASC",
      [applicationId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_job_keywords")
      .select("*")
      .eq("application_id", applicationId)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationKeywordRow[];
  }
}

export async function upsertApplicationKeywords(
  inputs: UpsertApplicationKeywordInput[]
): Promise<ApplicationKeywordRow[]> {
  if (inputs.length === 0) return [];

  if (isNeon()) {
    const results: ApplicationKeywordRow[] = [];
    for (const input of inputs) {
      const row = await queryOne<ApplicationKeywordRow>(
        `INSERT INTO application_job_keywords (
          application_id, job_id, keyword, normalized_keyword, category,
          importance, source, status, ai_reason, evidence_summary,
          evidence_status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (application_id, normalized_keyword) DO UPDATE SET
          job_id = EXCLUDED.job_id,
          keyword = EXCLUDED.keyword,
          category = EXCLUDED.category,
          importance = EXCLUDED.importance,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          ai_reason = EXCLUDED.ai_reason,
          evidence_summary = EXCLUDED.evidence_summary,
          evidence_status = EXCLUDED.evidence_status,
          created_by = EXCLUDED.created_by,
          updated_at = NOW()
        RETURNING *`,
        [
          input.application_id,
          input.job_id ?? null,
          input.keyword,
          input.normalized_keyword,
          input.category,
          input.importance ?? "medium",
          input.source ?? "ai_jd_analysis",
          input.status ?? "pending",
          input.ai_reason ?? null,
          input.evidence_summary ?? null,
          input.evidence_status ?? "unmapped",
          input.created_by ?? null,
        ]
      );
      if (row) results.push(row);
    }
    return results;
  } else {
    const rows = inputs.map((input) => ({
      application_id: input.application_id,
      job_id: input.job_id ?? null,
      keyword: input.keyword,
      normalized_keyword: input.normalized_keyword,
      category: input.category,
      importance: input.importance ?? "medium",
      source: input.source ?? "ai_jd_analysis",
      status: input.status ?? "pending",
      ai_reason: input.ai_reason ?? null,
      evidence_summary: input.evidence_summary ?? null,
      evidence_status: input.evidence_status ?? "unmapped",
      created_by: input.created_by ?? null,
    }));

    const { data, error } = await supabase
      .from("application_job_keywords")
      .upsert(rows, { onConflict: "application_id, normalized_keyword", ignoreDuplicates: false })
      .select();

    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationKeywordRow[];
  }
}

export async function updateApplicationKeyword(
  id: string,
  input: UpdateApplicationKeywordInput
): Promise<ApplicationKeywordRow> {
  if (isNeon()) {
    const setClauses: string[] = [];
    const params: (string | number | boolean | null | Date | object)[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }
    if (setClauses.length === 0) {
      throw new Error("No fields to update");
    }
    setClauses.push(`updated_at = $${idx++}`);
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE application_job_keywords SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`;
    const result = await queryOne<ApplicationKeywordRow>(sql, params);
    if (!result) throw new Error("Update failed");
    return result;
  } else {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      throw new Error("No fields to update");
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("application_job_keywords")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationKeywordRow;
  }
}

export async function bulkUpdateApplicationKeywordStatuses(
  updates: BulkUpdateInput[]
): Promise<ApplicationKeywordRow[]> {
  if (updates.length === 0) return [];

  // Supabase does not support true bulk UPDATE with different values per row.
  // We do sequential updates — the table is small (tens of keywords per application).
  const results: ApplicationKeywordRow[] = [];
  for (const u of updates) {
    const row = await updateApplicationKeyword(u.id, {
      status: u.status,
      user_reason: u.user_reason ?? undefined,
      reviewed_by: u.reviewed_by ?? undefined,
      reviewed_at: u.reviewed_by ? new Date().toISOString() : undefined,
      evidence_summary: u.evidence_summary ?? undefined,
      evidence_status: u.evidence_status ?? undefined,
    });
    results.push(row);
  }
  return results;
}

export async function deleteApplicationKeyword(id: string): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM application_job_keywords WHERE id = $1", [id]);
  } else {
    const { error } = await supabase.from("application_job_keywords").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
}

export async function deleteApplicationKeywordsByApplicationId(
  applicationId: string
): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM application_job_keywords WHERE application_id = $1", [applicationId]);
  } else {
    const { error } = await supabase
      .from("application_job_keywords")
      .delete()
      .eq("application_id", applicationId);
    if (error) throw new Error(error.message);
  }
}

// ───────────────────────────────────────────────────────────────
// Stats / helpers
// ───────────────────────────────────────────────────────────────

export async function countApplicationKeywordsByStatus(
  applicationId: string
): Promise<Record<string, number>> {
  if (isNeon()) {
    const rows = await query<{ status: string }>(
      "SELECT status FROM application_job_keywords WHERE application_id = $1",
      [applicationId]
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return counts;
  } else {
    const { data, error } = await supabase
      .from("application_job_keywords")
      .select("status", { count: "exact" })
      .eq("application_id", applicationId);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as any[]) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return counts;
  }
}

export async function getApplicationKeywordsGroupedByCategory(
  applicationId: string
): Promise<Record<string, ApplicationKeywordRow[]>> {
  const keywords = await listApplicationKeywords(applicationId);
  const grouped: Record<string, ApplicationKeywordRow[]> = {};
  for (const k of keywords) {
    if (!grouped[k.category]) grouped[k.category] = [];
    grouped[k.category].push(k);
  }
  return grouped;
}

// ───────────────────────────────────────────────────────────────
// Normalization helper
// ───────────────────────────────────────────────────────────────

export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function deduplicateKeywords(
  keywords: Array<{ keyword: string; normalized_keyword?: string }>
): Array<{ keyword: string; normalized_keyword: string }> {
  const seen = new Set<string>();
  const result: Array<{ keyword: string; normalized_keyword: string }> = [];
  for (const k of keywords) {
    const norm = k.normalized_keyword ?? normalizeKeyword(k.keyword);
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push({ keyword: k.keyword, normalized_keyword: norm });
  }
  return result;
}
