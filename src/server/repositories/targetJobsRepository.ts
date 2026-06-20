// src/server/repositories/targetJobsRepository.ts
// Data-access abstraction for the target_jobs table.
// Implementation uses Supabase today; interface designed for portability.

import { supabase } from "@/lib/supabase";

export interface TargetJobRow {
  id: string;
  candidate_id: string;
  job_id: string;
  raw_description: string;
  parsed_description: Record<string, unknown> | null;
  fit_score: number | null;
  recommendation: string | null;
  created_by: string | null;
  created_at: string | null;
}

export async function findTargetJobByCandidateAndJob(
  candidateId: string,
  jobId: string
): Promise<TargetJobRow | null> {
  const { data, error } = await supabase
    .from("target_jobs")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as TargetJobRow;
}
