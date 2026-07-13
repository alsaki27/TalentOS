// src/server/repositories/jobAgentKeywordGroupRepository.ts
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export interface KeywordGroup {
  id: string;
  label: string;
  keywords: string[];
  created_at: string;
  updated_at: string;
}

const COLS = "id, label, keywords, created_at, updated_at";

export async function listKeywordGroups(): Promise<KeywordGroup[]> {
  if (isNeon()) {
    return await query<KeywordGroup>(`SELECT ${COLS} FROM job_agent_keyword_groups ORDER BY created_at DESC`);
  }
  const { data, error } = await supabase.from("job_agent_keyword_groups").select(COLS).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KeywordGroup[];
}

export async function getKeywordGroupById(id: string): Promise<KeywordGroup | null> {
  if (isNeon()) {
    return await queryOne<KeywordGroup>(`SELECT ${COLS} FROM job_agent_keyword_groups WHERE id = $1`, [id]);
  }
  const { data, error } = await supabase.from("job_agent_keyword_groups").select(COLS).eq("id", id).single();
  if (error) return null;
  return data as KeywordGroup;
}

export async function createKeywordGroup(label: string, keywords: string[]): Promise<KeywordGroup> {
  if (isNeon()) {
    const row = await queryOne<KeywordGroup>(
      `INSERT INTO job_agent_keyword_groups (label, keywords) VALUES ($1, $2) RETURNING ${COLS}`,
      [label, keywords]
    );
    if (!row) throw new Error("Insert failed");
    return row;
  }
  const { data, error } = await supabase.from("job_agent_keyword_groups").insert({ label, keywords }).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as KeywordGroup;
}

export async function updateKeywordGroup(id: string, label?: string, keywords?: string[]): Promise<KeywordGroup> {
  if (isNeon()) {
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (label !== undefined) { fields.push(`label = $${idx++}`); values.push(label); }
    if (keywords !== undefined) { fields.push(`keywords = $${idx++}`); values.push(keywords); }
    if (fields.length === 0) throw new Error("No fields to update");
    fields.push(`updated_at = $${idx++}`); values.push(new Date().toISOString()); values.push(id);
    const row = await queryOne<KeywordGroup>(`UPDATE job_agent_keyword_groups SET ${fields.join(", ")} WHERE id = $${idx} RETURNING ${COLS}`, values);
    if (!row) throw new Error("Update failed");
    return row;
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (label !== undefined) updates.label = label;
  if (keywords !== undefined) updates.keywords = keywords;
  const { data, error } = await supabase.from("job_agent_keyword_groups").update(updates).eq("id", id).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as KeywordGroup;
}

export async function deleteKeywordGroup(id: string): Promise<boolean> {
  if (isNeon()) {
    const r = await execute("DELETE FROM job_agent_keyword_groups WHERE id = $1", [id]);
    return r.rowCount > 0;
  }
  const { error } = await supabase.from("job_agent_keyword_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}