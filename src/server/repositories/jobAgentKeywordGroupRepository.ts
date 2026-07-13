// src/server/repositories/jobAgentKeywordGroupRepository.ts
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
  return await query<KeywordGroup>(`SELECT ${COLS} FROM job_agent_keyword_groups ORDER BY created_at DESC`);
}

export async function getKeywordGroupById(id: string): Promise<KeywordGroup | null> {
  return await queryOne<KeywordGroup>(`SELECT ${COLS} FROM job_agent_keyword_groups WHERE id = $1`, [id]);
}

export async function createKeywordGroup(label: string, keywords: string[]): Promise<KeywordGroup> {
  const row = await queryOne<KeywordGroup>(
    `INSERT INTO job_agent_keyword_groups (label, keywords) VALUES ($1, $2) RETURNING ${COLS}`,
    [label, keywords]
  );
  if (!row) throw new Error("Insert failed");
  return row;
}

export async function updateKeywordGroup(id: string, label?: string, keywords?: string[]): Promise<KeywordGroup> {
  const fields: string[] = []; const values: any[] = []; let idx = 1;
  if (label !== undefined) { fields.push(`label = $${idx++}`); values.push(label); }
  if (keywords !== undefined) { fields.push(`keywords = $${idx++}`); values.push(keywords); }
  if (fields.length === 0) throw new Error("No fields to update");
  fields.push(`updated_at = $${idx++}`); values.push(new Date().toISOString()); values.push(id);
  const row = await queryOne<KeywordGroup>(`UPDATE job_agent_keyword_groups SET ${fields.join(", ")} WHERE id = $${idx} RETURNING ${COLS}`, values);
  if (!row) throw new Error("Update failed");
  return row;
}

export async function deleteKeywordGroup(id: string): Promise<boolean> {
  const r = await execute("DELETE FROM job_agent_keyword_groups WHERE id = $1", [id]);
  return r.rowCount > 0;
}