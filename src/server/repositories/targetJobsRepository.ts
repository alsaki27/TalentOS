// src/server/repositories/targetJobsRepository.ts
// Data-access abstraction for the target_jobs table.

import { queryOne, query, execute } from "@/server/db/neon";

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
  return queryOne<TargetJobRow>(
    "SELECT * FROM target_jobs WHERE candidate_id = $1 AND job_id = $2",
    [candidateId, jobId]
  );
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────

export async function findTargetJobById(id: string): Promise<any | null> {
  return queryOne<any>(
    `
    SELECT t.*,
      COALESCE(
        (SELECT jsonb_agg(k.*) FROM job_keywords k WHERE k.target_job_id = t.id),
        '[]'::jsonb
      ) as job_keywords
    FROM target_jobs t
    WHERE t.id = $1
    `,
    [id]
  );
}

export async function listTargetJobsByCandidate(candidateId: string): Promise<any[]> {
  return query<any>(
    `
    SELECT t.*,
      COALESCE(
        (SELECT jsonb_agg(k.*) FROM job_keywords k WHERE k.target_job_id = t.id),
        '[]'::jsonb
      ) as job_keywords
    FROM target_jobs t
    WHERE t.candidate_id = $1
    ORDER BY t.created_at DESC
    `,
    [candidateId]
  );
}

export async function createTargetJob(input: Record<string, unknown>): Promise<any> {
  const cols = Object.keys(input);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = cols.map((c) => input[c]) as (string | number | boolean | object | Date | null)[];
  const sql = `INSERT INTO target_jobs (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
  return queryOne<any>(sql, values);
}

export async function upsertTargetJobByCandidateAndJob(
  candidateId: string,
  jobId: string | null,
  input: Record<string, unknown>
): Promise<any> {
  const allCols = ["candidate_id", "job_id", ...Object.keys(input).filter((k) => k !== "candidate_id" && k !== "job_id")];
  const allValues = allCols.map((c) => {
    if (c === "candidate_id") return candidateId;
    if (c === "job_id") return jobId;
    return input[c];
  }) as (string | number | boolean | object | Date | null)[];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(", ");
  const updateCols = allCols.filter((c) => c !== "candidate_id" && c !== "job_id");
  const updateClause =
    updateCols.length > 0
      ? updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")
      : "candidate_id = EXCLUDED.candidate_id";
  const sql = `
    INSERT INTO target_jobs (${allCols.join(", ")}) VALUES (${placeholders})
    ON CONFLICT (candidate_id, job_id) DO UPDATE SET ${updateClause}
    RETURNING *
  `;
  return queryOne<any>(sql, allValues);
}

export async function updateTargetJob(id: string, updates: Record<string, unknown>): Promise<any> {
  const keys = Object.keys(updates).filter((k) => updates[k] !== undefined);
  if (keys.length === 0) throw new Error("No fields to update");
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
  values.push(id);
  const sql = `UPDATE target_jobs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
  return queryOne<any>(sql, values);
}

export async function deleteTargetJob(id: string): Promise<void> {
  await execute("DELETE FROM target_jobs WHERE id = $1", [id]);
}
