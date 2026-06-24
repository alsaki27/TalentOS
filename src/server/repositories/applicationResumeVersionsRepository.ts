// src/server/repositories/applicationResumeVersionsRepository.ts
// Data-access abstraction for application_resume_versions table.
// Implementation supports both Supabase and Neon backends.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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
  if (isNeon()) {
    return await queryOne<ApplicationResumeVersionRow>(
      "SELECT * FROM application_resume_versions WHERE id = $1",
      [id]
    );
  } else {
    const { data, error } = await supabase
      .from("application_resume_versions")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as ApplicationResumeVersionRow;
  }
}

export async function listResumeVersionsByCandidate(
  candidateId: string
): Promise<ApplicationResumeVersionRow[]> {
  if (isNeon()) {
    return await query<ApplicationResumeVersionRow>(
      `SELECT id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at
       FROM application_resume_versions
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [candidateId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_resume_versions")
      .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeVersionRow[];
  }
}

export async function listResumeVersionsByApplication(
  candidateId: string,
  targetJobId: string
): Promise<ApplicationResumeVersionRow[]> {
  if (isNeon()) {
    return await query<ApplicationResumeVersionRow>(
      `SELECT id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at
       FROM application_resume_versions
       WHERE candidate_id = $1 AND target_job_id = $2
       ORDER BY created_at DESC`,
      [candidateId, targetJobId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_resume_versions")
      .select("id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label, generated_text, status, source_type, ats_score, truth_score, one_page_fit_score, created_by, created_at, updated_at")
      .eq("candidate_id", candidateId)
      .eq("target_job_id", targetJobId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ApplicationResumeVersionRow[];
  }
}

export async function createApplicationResumeVersion(
  input: CreateApplicationResumeVersionInput
): Promise<ApplicationResumeVersionRow> {
  if (isNeon()) {
    const result = await queryOne<ApplicationResumeVersionRow>(
      `INSERT INTO application_resume_versions (
        candidate_id, base_resume_id, target_job_id, content, formatting,
        status, source_type, title, version_label, generated_text,
        source_resume_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        input.candidate_id,
        input.base_resume_id ?? null,
        input.target_job_id,
        input.content,
        input.formatting ?? null,
        input.status ?? "draft",
        input.source_type ?? "base_resume",
        input.title ?? null,
        input.version_label ?? null,
        input.generated_text ?? null,
        input.source_resume_id ?? null,
        input.created_by ?? null,
      ]
    );
    if (!result) throw new Error("Failed to create resume version");
    return result;
  } else {
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
}

export async function updateApplicationResumeVersion(
  id: string,
  input: UpdateApplicationResumeVersionInput
): Promise<ApplicationResumeVersionRow> {
  if (isNeon()) {
    const fields: string[] = [];
    const values: (string | number | boolean | object | Date | null)[] = [];
    let paramIndex = 1;

    if (input.content !== undefined) {
      fields.push(`content = $${paramIndex++}`);
      values.push(input.content);
    }
    if (input.formatting !== undefined) {
      fields.push(`formatting = $${paramIndex++}`);
      values.push(input.formatting);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.ats_score !== undefined) {
      fields.push(`ats_score = $${paramIndex++}`);
      values.push(input.ats_score);
    }
    if (input.truth_score !== undefined) {
      fields.push(`truth_score = $${paramIndex++}`);
      values.push(input.truth_score);
    }
    if (input.one_page_fit_score !== undefined) {
      fields.push(`one_page_fit_score = $${paramIndex++}`);
      values.push(input.one_page_fit_score);
    }
    if (input.title !== undefined) {
      fields.push(`title = $${paramIndex++}`);
      values.push(input.title);
    }
    if (input.version_label !== undefined) {
      fields.push(`version_label = $${paramIndex++}`);
      values.push(input.version_label);
    }
    if (input.generated_text !== undefined) {
      fields.push(`generated_text = $${paramIndex++}`);
      values.push(input.generated_text);
    }
    if (input.source_resume_id !== undefined) {
      fields.push(`source_resume_id = $${paramIndex++}`);
      values.push(input.source_resume_id);
    }

    fields.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());
    values.push(id);

    if (fields.length === 1) {
      throw new Error("No fields to update");
    }

    const result = await queryOne<ApplicationResumeVersionRow>(
      `UPDATE application_resume_versions SET ${fields.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (!result) throw new Error("Failed to update resume version");
    return result;
  } else {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 1) {
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
}

export async function deleteResumeVersion(id: string): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM application_resume_versions WHERE id = $1", [id]);
  } else {
    const { error } = await supabase
      .from("application_resume_versions")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
}

// ───────────────────────────────────────────────────────────────
// Draft helpers
// ───────────────────────────────────────────────────────────────

export async function getCurrentDraftForApplication(
  candidateId: string,
  targetJobId: string
): Promise<ApplicationResumeVersionRow | null> {
  if (isNeon()) {
    return await queryOne<ApplicationResumeVersionRow>(
      `SELECT * FROM application_resume_versions
       WHERE candidate_id = $1 AND target_job_id = $2 AND status = $3
       ORDER BY updated_at DESC
       LIMIT 1`,
      [candidateId, targetJobId, "draft"]
    );
  } else {
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

  if (isNeon()) {
    const result = await queryOne<ApplicationResumeVersionRow>(
      `INSERT INTO application_resume_versions (
        candidate_id, base_resume_id, target_job_id, content, formatting,
        status, source_type, title, version_label, generated_text,
        source_resume_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        row.candidate_id as string,
        row.base_resume_id as string | null,
        row.target_job_id as string,
        row.content as Record<string, unknown>,
        row.formatting as Record<string, unknown> | null,
        row.status as string,
        row.source_type as string,
        row.title as string | null,
        row.version_label as string | null,
        row.generated_text as string | null,
        row.source_resume_id as string | null,
        row.created_by as string | null,
      ]
    );
    if (!result) throw new Error("Failed to clone resume version");
    return result;
  } else {
    const { data, error } = await supabase
      .from("application_resume_versions")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ApplicationResumeVersionRow;
  }
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
  if (isNeon()) {
    await execute(
      `UPDATE application_packets
       SET final_resume_version_id = $1, updated_at = $2
       WHERE application_id = $3`,
      [resumeVersionId, new Date().toISOString(), applicationId]
    );
  } else {
    const { error } = await supabase
      .from("application_packets")
      .update({ final_resume_version_id: resumeVersionId, updated_at: new Date().toISOString() })
      .eq("application_id", applicationId);
    if (error) throw new Error(error.message);
  }
}

export async function getPacketForApplication(
  applicationId: string
): Promise<{ application_id: string; final_resume_version_id: string | null } | null> {
  if (isNeon()) {
    return await queryOne<{ application_id: string; final_resume_version_id: string | null }>(
      `SELECT application_id, final_resume_version_id FROM application_packets WHERE application_id = $1`,
      [applicationId]
    );
  } else {
    const { data, error } = await supabase
      .from("application_packets")
      .select("application_id, final_resume_version_id")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (error || !data) return null;
    return data as { application_id: string; final_resume_version_id: string | null };
  }
}

export async function createOrUpdatePacket(
  applicationId: string,
  resumeVersionId: string
): Promise<void> {
  const existing = await getPacketForApplication(applicationId);
  if (existing) {
    await attachResumeVersionToPacket(applicationId, resumeVersionId);
  } else {
    if (isNeon()) {
      await execute(
        `INSERT INTO application_packets (application_id, final_resume_version_id) VALUES ($1, $2)`,
        [applicationId, resumeVersionId]
      );
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
}
