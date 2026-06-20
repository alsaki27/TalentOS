// src/server/repositories/applicationPacketsRepository.ts
// Repository for application_packets table.
// All new packet feature code goes through this abstraction.

import { supabase } from "@/lib/supabase";

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
  const { data, error } = await supabase
    .from("application_packets")
    .select("*")
    .eq("application_id", applicationId)
    .single();

  if (error) return null;
  return data as ApplicationPacketRow | null;
}

// ───────────────────────────────────────────────────────────────
// Create
// ───────────────────────────────────────────────────────────────

export async function createPacket(
  input: CreatePacketInput
): Promise<ApplicationPacketRow> {
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

// ───────────────────────────────────────────────────────────────
// Update
// ───────────────────────────────────────────────────────────────

export async function updatePacket(
  applicationId: string,
  input: UpdatePacketInput
): Promise<ApplicationPacketRow> {
  const { data, error } = await supabase
    .from("application_packets")
    .update(input)
    .eq("application_id", applicationId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update packet: ${error.message}`);
  return data as ApplicationPacketRow;
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
