// src/server/repositories/jobAgentConfigRepository.ts
// Simplified — no token, actor, budget. Only label, max_results, role_groups, is_active.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export interface JobAgentConfigRow {
  id: string;
  label: string;
  max_results: number;
  role_groups: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type JobAgentConfigMetadata = JobAgentConfigRow;

export interface CreateJobAgentConfigInput {
  label: string;
  maxResults?: number;
  roleGroups?: string[];
  isActive?: boolean;
}

export interface UpdateJobAgentConfigInput {
  label?: string;
  maxResults?: number;
  roleGroups?: string[];
  isActive?: boolean;
}

const COLUMNS = "id, label, max_results, role_groups, is_active, created_at, updated_at";

export async function listConfigs(): Promise<JobAgentConfigMetadata[]> {
  if (isNeon()) {
    const rows = await query<JobAgentConfigRow>(
      `SELECT ${COLUMNS} FROM job_agent_configs ORDER BY created_at DESC`
    );
    return rows;
  }
  const { data, error } = await supabase.from("job_agent_configs").select(COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as JobAgentConfigRow[];
}

export async function getConfigById(id: string): Promise<JobAgentConfigRow | null> {
  if (isNeon()) {
    return await queryOne<JobAgentConfigRow>(`SELECT ${COLUMNS} FROM job_agent_configs WHERE id = $1`, [id]);
  }
  const { data, error } = await supabase.from("job_agent_configs").select(COLUMNS).eq("id", id).single();
  if (error) return null;
  return data as JobAgentConfigRow;
}

export async function getDefaultConfig(): Promise<JobAgentConfigRow> {
  const configs = await listConfigs();
  if (configs.length > 0) return configs[0];
  // Auto-create default config
  if (isNeon()) {
    const row = await queryOne<JobAgentConfigRow>(
      `INSERT INTO job_agent_configs (label, max_results, role_groups, is_active) VALUES ('Default', 500, '{}', true) RETURNING ${COLUMNS}`
    );
    if (!row) throw new Error("Failed to create default config");
    return row;
  }
  const { data, error } = await supabase.from("job_agent_configs")    .insert({ label: "Default", max_results: 500, role_groups: [], is_active: true }).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as JobAgentConfigRow;
}

export async function createConfig(input: CreateJobAgentConfigInput): Promise<JobAgentConfigMetadata> {
  const max = Math.min(500, Math.max(1, input.maxResults ?? 500));
  const groups = input.roleGroups ?? [];
  const active = input.isActive ?? true;
  if (isNeon()) {
    const row = await queryOne<JobAgentConfigRow>(
      `INSERT INTO job_agent_configs (label, max_results, role_groups, is_active) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [input.label, max, groups, active]
    );
    if (!row) throw new Error("Insert failed");
    return row;
  }
  const { data, error } = await supabase.from("job_agent_configs").insert({ label: input.label, max_results: max, role_groups: groups, is_active: active }).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as JobAgentConfigRow;
}

export async function updateConfig(id: string, input: UpdateJobAgentConfigInput): Promise<JobAgentConfigMetadata> {
  if (isNeon()) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (input.label !== undefined) { fields.push(`label = $${idx++}`); values.push(input.label); }
    if (input.maxResults !== undefined) { fields.push(`max_results = $${idx++}`); values.push(Math.min(500, Math.max(1, input.maxResults))); }
    if (input.roleGroups !== undefined) { fields.push(`role_groups = $${idx++}`); values.push(input.roleGroups); }
    if (input.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(input.isActive); }
    if (fields.length === 0) throw new Error("No fields to update");
    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(id);
    const row = await queryOne<JobAgentConfigRow>(
      `UPDATE job_agent_configs SET ${fields.join(", ")} WHERE id = $${idx} RETURNING ${COLUMNS}`, values
    );
    if (!row) throw new Error("Update failed");
    return row;
  }
  const updates: Record<string, unknown> = {};
  if (input.label !== undefined) updates.label = input.label;
  if (input.maxResults !== undefined) updates.max_results = Math.min(500, Math.max(1, input.maxResults));
  if (input.roleGroups !== undefined) updates.role_groups = input.roleGroups;
  if (input.isActive !== undefined) updates.is_active = input.isActive;
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("job_agent_configs").update(updates).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as JobAgentConfigRow;
}

export async function deleteConfig(id: string): Promise<{ ok: boolean }> {
  if (isNeon()) {
    const res = await execute(`UPDATE job_agent_configs SET is_active = false, updated_at = $1 WHERE id = $2`, [new Date().toISOString(), id]);
    return { ok: res.rowCount > 0 };
  }
  const { error } = await supabase.from("job_agent_configs").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}