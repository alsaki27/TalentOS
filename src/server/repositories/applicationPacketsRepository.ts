// src/server/repositories/applicationPacketsRepository.ts
// Repository for application_packets table.
// All new packet feature code goes through this abstraction.

import { supabase } from "@/lib/supabase";
import { isNeon, query as dbQuery, queryOne, execute } from "@/server/db";

export type PacketStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "sent"
  | "archived";

export interface ApplicationPacketRow {
  application_id: string;
  base_resume_id: string | null;
  target_job_id: string | null;
  final_resume_version_id: string | null;
  resume_export_id: string | null;
  approved_keyword_ids: string[] | null;
  rejected_keyword_ids: string[] | null;
  cover_letter: string | null;
  recruiter_message: string | null;
  hiring_manager_email: string | null;
  interview_prep_notes: string | null;
  final_notes: string | null;
  packet_status: PacketStatus;
  checklist: Record<string, unknown>;
  warnings: unknown[];
  ai_summary: Record<string, unknown> | null;
  created_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  sent_by: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePacketInput {
  application_id: string;
  base_resume_id?: string | null;
  target_job_id?: string | null;
  final_resume_version_id?: string | null;
  resume_export_id?: string | null;
  approved_keyword_ids?: string[] | null;
  rejected_keyword_ids?: string[] | null;
  cover_letter?: string | null;
  recruiter_message?: string | null;
  hiring_manager_email?: string | null;
  interview_prep_notes?: string | null;
  final_notes?: string | null;
  packet_status?: PacketStatus;
  checklist?: Record<string, unknown>;
  warnings?: unknown[];
  ai_summary?: Record<string, unknown> | null;
  created_by?: string | null;
}

export interface UpdatePacketInput {
  base_resume_id?: string | null;
  target_job_id?: string | null;
  final_resume_version_id?: string | null;
  resume_export_id?: string | null;
  approved_keyword_ids?: string[] | null;
  rejected_keyword_ids?: string[] | null;
  cover_letter?: string | null;
  recruiter_message?: string | null;
  hiring_manager_email?: string | null;
  interview_prep_notes?: string | null;
  final_notes?: string | null;
  packet_status?: PacketStatus;
  checklist?: Record<string, unknown>;
  warnings?: unknown[];
  ai_summary?: Record<string, unknown> | null;
  reviewed_by?: string | null;
  approved_by?: string | null;
  sent_by?: string | null;
  reviewed_at?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
}

export interface ListPacketsQuery {
  applicationId?: string;
  status?: PacketStatus;
  candidateId?: string;
  limit?: number;
  offset?: number;
}

// ───────────────────────────────────────────────────────────────
// Find by application_id (primary key)
// ───────────────────────────────────────────────────────────────

export async function findPacketByApplicationId(
  applicationId: string
): Promise<ApplicationPacketRow | null> {
  if (isNeon()) {
    const result = await queryOne<ApplicationPacketRow>(
      "SELECT * FROM application_packets WHERE application_id = $1",
      [applicationId]
    );
    return result;
  } else {
    const { data, error } = await supabase
      .from("application_packets")
      .select("*")
      .eq("application_id", applicationId)
      .single();

    if (error) return null;
    return data as ApplicationPacketRow | null;
  }
}

// ───────────────────────────────────────────────────────────────
// Create
// ───────────────────────────────────────────────────────────────

export async function createPacket(
  input: CreatePacketInput
): Promise<ApplicationPacketRow> {
  if (isNeon()) {
    const result = await queryOne<ApplicationPacketRow>(
      `INSERT INTO application_packets (
        application_id, base_resume_id, target_job_id, final_resume_version_id,
        resume_export_id, approved_keyword_ids, rejected_keyword_ids, cover_letter,
        recruiter_message, hiring_manager_email, interview_prep_notes, final_notes,
        packet_status, checklist, warnings, ai_summary, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        input.application_id,
        input.base_resume_id ?? null,
        input.target_job_id ?? null,
        input.final_resume_version_id ?? null,
        input.resume_export_id ?? null,
        input.approved_keyword_ids ?? null,
        input.rejected_keyword_ids ?? null,
        input.cover_letter ?? null,
        input.recruiter_message ?? null,
        input.hiring_manager_email ?? null,
        input.interview_prep_notes ?? null,
        input.final_notes ?? null,
        input.packet_status ?? "draft",
        input.checklist ?? {},
        input.warnings ?? [],
        input.ai_summary ?? null,
        input.created_by ?? null,
      ]
    );
    if (!result) throw new Error("Failed to create packet");
    return result;
  } else {
    const { data, error } = await supabase
      .from("application_packets")
      .insert({
        application_id: input.application_id,
        base_resume_id: input.base_resume_id ?? null,
        target_job_id: input.target_job_id ?? null,
        final_resume_version_id: input.final_resume_version_id ?? null,
        resume_export_id: input.resume_export_id ?? null,
        approved_keyword_ids: input.approved_keyword_ids ?? null,
        rejected_keyword_ids: input.rejected_keyword_ids ?? null,
        cover_letter: input.cover_letter ?? null,
        recruiter_message: input.recruiter_message ?? null,
        hiring_manager_email: input.hiring_manager_email ?? null,
        interview_prep_notes: input.interview_prep_notes ?? null,
        final_notes: input.final_notes ?? null,
        packet_status: input.packet_status ?? "draft",
        checklist: input.checklist ?? {},
        warnings: input.warnings ?? [],
        ai_summary: input.ai_summary ?? null,
        created_by: input.created_by ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create packet: ${error.message}`);
    return data as ApplicationPacketRow;
  }
}

// ───────────────────────────────────────────────────────────────
// Update
// ───────────────────────────────────────────────────────────────

export async function updatePacket(
  applicationId: string,
  input: UpdatePacketInput
): Promise<ApplicationPacketRow> {
  if (isNeon()) {
    const fields: string[] = [];
    const values: (string | number | boolean | null | Date | object)[] = [];
    let idx = 1;

    if (input.base_resume_id !== undefined) {
      fields.push(`base_resume_id = $${idx++}`);
      values.push(input.base_resume_id);
    }
    if (input.target_job_id !== undefined) {
      fields.push(`target_job_id = $${idx++}`);
      values.push(input.target_job_id);
    }
    if (input.final_resume_version_id !== undefined) {
      fields.push(`final_resume_version_id = $${idx++}`);
      values.push(input.final_resume_version_id);
    }
    if (input.resume_export_id !== undefined) {
      fields.push(`resume_export_id = $${idx++}`);
      values.push(input.resume_export_id);
    }
    if (input.approved_keyword_ids !== undefined) {
      fields.push(`approved_keyword_ids = $${idx++}`);
      values.push(input.approved_keyword_ids);
    }
    if (input.rejected_keyword_ids !== undefined) {
      fields.push(`rejected_keyword_ids = $${idx++}`);
      values.push(input.rejected_keyword_ids);
    }
    if (input.cover_letter !== undefined) {
      fields.push(`cover_letter = $${idx++}`);
      values.push(input.cover_letter);
    }
    if (input.recruiter_message !== undefined) {
      fields.push(`recruiter_message = $${idx++}`);
      values.push(input.recruiter_message);
    }
    if (input.hiring_manager_email !== undefined) {
      fields.push(`hiring_manager_email = $${idx++}`);
      values.push(input.hiring_manager_email);
    }
    if (input.interview_prep_notes !== undefined) {
      fields.push(`interview_prep_notes = $${idx++}`);
      values.push(input.interview_prep_notes);
    }
    if (input.final_notes !== undefined) {
      fields.push(`final_notes = $${idx++}`);
      values.push(input.final_notes);
    }
    if (input.packet_status !== undefined) {
      fields.push(`packet_status = $${idx++}`);
      values.push(input.packet_status);
    }
    if (input.checklist !== undefined) {
      fields.push(`checklist = $${idx++}`);
      values.push(input.checklist);
    }
    if (input.warnings !== undefined) {
      fields.push(`warnings = $${idx++}`);
      values.push(input.warnings);
    }
    if (input.ai_summary !== undefined) {
      fields.push(`ai_summary = $${idx++}`);
      values.push(input.ai_summary);
    }
    if (input.reviewed_by !== undefined) {
      fields.push(`reviewed_by = $${idx++}`);
      values.push(input.reviewed_by);
    }
    if (input.approved_by !== undefined) {
      fields.push(`approved_by = $${idx++}`);
      values.push(input.approved_by);
    }
    if (input.sent_by !== undefined) {
      fields.push(`sent_by = $${idx++}`);
      values.push(input.sent_by);
    }
    if (input.reviewed_at !== undefined) {
      fields.push(`reviewed_at = $${idx++}`);
      values.push(input.reviewed_at);
    }
    if (input.approved_at !== undefined) {
      fields.push(`approved_at = $${idx++}`);
      values.push(input.approved_at);
    }
    if (input.sent_at !== undefined) {
      fields.push(`sent_at = $${idx++}`);
      values.push(input.sent_at);
    }

    if (fields.length === 0) {
      const existing = await findPacketByApplicationId(applicationId);
      if (!existing) throw new Error("Packet not found");
      return existing;
    }

    const sql = `UPDATE application_packets SET ${fields.join(", ")} WHERE application_id = $${idx} RETURNING *`;
    values.push(applicationId);

    const result = await queryOne<ApplicationPacketRow>(sql, values);
    if (!result) throw new Error("Failed to update packet");
    return result;
  } else {
    const { data, error } = await supabase
      .from("application_packets")
      .update(input)
      .eq("application_id", applicationId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update packet: ${error.message}`);
    return data as ApplicationPacketRow;
  }
}

// ───────────────────────────────────────────────────────────────
// Upsert — create if missing, update if exists
// ───────────────────────────────────────────────────────────────

export async function upsertPacketForApplication(
  applicationId: string,
  input: UpdatePacketInput & { created_by?: string | null }
): Promise<ApplicationPacketRow> {
  const existing = await findPacketByApplicationId(applicationId);
  if (existing) {
    return updatePacket(applicationId, input);
  }

  return createPacket({
    application_id: applicationId,
    ...input,
  });
}

// ───────────────────────────────────────────────────────────────
// Update status
// ───────────────────────────────────────────────────────────────

export async function updatePacketStatus(
  applicationId: string,
  status: PacketStatus,
  actorId?: string | null
): Promise<ApplicationPacketRow> {
  const updates: UpdatePacketInput = { packet_status: status };

  if (status === "ready_for_review") {
    updates.reviewed_by = actorId ?? null;
    updates.reviewed_at = new Date().toISOString();
  } else if (status === "approved") {
    updates.approved_by = actorId ?? null;
    updates.approved_at = new Date().toISOString();
  } else if (status === "sent") {
    updates.sent_by = actorId ?? null;
    updates.sent_at = new Date().toISOString();
  }

  return updatePacket(applicationId, updates);
}

// ───────────────────────────────────────────────────────────────
// Mark approved
// ───────────────────────────────────────────────────────────────

export async function markPacketApproved(
  applicationId: string,
  actorId: string
): Promise<ApplicationPacketRow> {
  return updatePacketStatus(applicationId, "approved", actorId);
}

// ───────────────────────────────────────────────────────────────
// Mark sent
// ───────────────────────────────────────────────────────────────

export async function markPacketSent(
  applicationId: string,
  actorId: string
): Promise<ApplicationPacketRow> {
  return updatePacketStatus(applicationId, "sent", actorId);
}

// ───────────────────────────────────────────────────────────────
// List with filters
// ───────────────────────────────────────────────────────────────

export async function listPackets(
  query: ListPacketsQuery = {}
): Promise<ApplicationPacketRow[]> {
  if (isNeon()) {
    const conditions: string[] = [];
    const values: (string | number | boolean | null | Date | object)[] = [];
    let idx = 1;

    if (query.applicationId) {
      conditions.push(`application_id = $${idx++}`);
      values.push(query.applicationId);
    }

    if (query.status) {
      conditions.push(`packet_status = $${idx++}`);
      values.push(query.status);
    }

    if (query.candidateId) {
      const appRows = await dbQuery<{ id: string }>(
        "SELECT id FROM applications WHERE candidate_id = $1",
        [query.candidateId]
      );
      const appIds = appRows.map((r) => r.id);
      if (appIds.length === 0) return [];
      conditions.push(`application_id = ANY($${idx++})`);
      values.push(appIds);
    }

    let sql = "SELECT * FROM application_packets";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    if (query.offset && query.limit) {
      sql += ` OFFSET $${idx++} LIMIT $${idx++}`;
      values.push(query.offset, query.limit);
    } else if (query.limit) {
      sql += ` LIMIT $${idx++}`;
      values.push(query.limit);
    }

    return await dbQuery<ApplicationPacketRow>(sql, values);
  } else {
    let builder = supabase
      .from("application_packets")
      .select("*");

    if (query.applicationId) {
      builder = builder.eq("application_id", query.applicationId);
    }

    if (query.status) {
      builder = builder.eq("packet_status", query.status);
    }

    if (query.candidateId) {
      // Need to join through applications table
      const { data: applications } = await supabase
        .from("applications")
        .select("id")
        .eq("candidate_id", query.candidateId);
      const appIds = (applications ?? []).map((a: any) => a.id as string);
      if (appIds.length === 0) return [];
      builder = builder.in("application_id", appIds);
    }

    builder = builder.order("created_at", { ascending: false });

    if (query.limit) {
      builder = builder.limit(query.limit);
    }
    if (query.offset && query.limit) {
      builder = builder.range(query.offset, query.offset + query.limit - 1);
    }

    const { data, error } = await builder;

    if (error) throw new Error(`Failed to list packets: ${error.message}`);
    return (data ?? []) as ApplicationPacketRow[];
  }
}
