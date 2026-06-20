// src/server/repositories/targetJobsRepository.ts
// Data-access abstraction for the target_jobs table.
// Supports both Neon and Supabase via DB_PROVIDER switch.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";

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
  if (isNeon()) {
    return queryOne<TargetJobRow>(
      "SELECT * FROM target_jobs WHERE candidate_id = $1 AND job_id = $2",
      [candidateId, jobId]
    );
  }
  const { data, error } = await supabase
    .from("target_jobs")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as TargetJobRow;
}
