// src/server/repositories/candidatesRepository.ts
// Data-access abstraction for the candidates table.
// Implementation supports both Supabase and Neon backends.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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
  created_at: string | null;
  updated_at: string | null;
}

export async function findCandidateById(id: string): Promise<CandidateRow | null> {
  if (isNeon()) {
    const row = await queryOne<CandidateRow>(
      `SELECT * FROM candidates WHERE id = $1`,
      [id]
    );
    return row ?? null;
  } else {
    const { data, error } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as CandidateRow;
  }
}

// ───────────────────────────────────────────────────────────────
// Listing / counts
// ───────────────────────────────────────────────────────────────

export async function listCandidates(
  opts: { status?: string | null; target_tier?: string | null; search?: string | null; limit?: number } = {}
): Promise<CandidateRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  if (isNeon()) {
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
  let q = supabase.from("candidates").select("*");
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.target_tier) q = q.eq("target_tier", opts.target_tier);
  if (opts.search) q = q.or(`name.ilike.%${opts.search}%,email.ilike.%${opts.search}%`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as CandidateRow[];
}

export async function countCandidates(): Promise<number> {
  if (isNeon()) {
    const row = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM candidates");
    return row?.count ?? 0;
  }
  const { count, error } = await supabase.from("candidates").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}
