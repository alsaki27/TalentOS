// src/server/repositories/candidatesRepository.ts
// Data-access abstraction for the candidates table.

import { query, queryOne } from "@/server/db/neon";

export interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  target_roles: string | null;
  target_industries: string[] | null;
  preferred_locations: string[] | null;
  work_authorization: string | null;
  visa_status: string | null;
  notes: string | null;
  skills: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  location_preference: string | null;
  work_mode_preference: string | null;
  available_start_date: string | null;
  eeo_gender: string | null;
  eeo_race: string | null;
  eeo_veteran: string | null;
  eeo_disability: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export async function findCandidateById(id: string): Promise<CandidateRow | null> {
  const row = await queryOne<CandidateRow>(
    `SELECT * FROM candidates WHERE id = $1`,
    [id]
  );
  return row ?? null;
}

// ───────────────────────────────────────────────────────────────
// Listing / counts
// ───────────────────────────────────────────────────────────────

export async function listCandidates(
  opts: { status?: string | null; target_tier?: string | null; search?: string | null; limit?: number } = {}
): Promise<CandidateRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const conditions: string[] = [];
  const values: (string | number | null)[] = [];
  let idx = 1;
  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    values.push(opts.status);
  }
  if (opts.target_tier) {
    conditions.push(`target_tier = $${idx++}`);
    values.push(opts.target_tier);
  }
  if (opts.search) {
    conditions.push(`(name ILIKE $${idx++} OR email ILIKE $${idx++})`);
    values.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM candidates ${where} ORDER BY created_at DESC LIMIT $${idx}`;
  values.push(limit);
  return query<CandidateRow>(sql, values);
}

export async function countCandidates(): Promise<number> {
  const row = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM candidates");
  return row?.count ?? 0;
}
