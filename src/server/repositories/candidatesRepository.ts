// src/server/repositories/candidatesRepository.ts
// Data-access abstraction for the candidates table.
// Implementation uses Supabase today; interface designed for portability.

import { supabase } from "@/lib/supabase";

export interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  target_roles: string | null;
  target_industries: string[] | null;
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
  const { data, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as CandidateRow;
}
