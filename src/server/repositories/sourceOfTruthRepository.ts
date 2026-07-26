import { query, queryOne, execute } from "@/server/db/neon";

export interface SoTRow {
  id: string;
  candidate_id: string;
  confirmed_skills: string[];
  pending_skills: PendingSkill[];
  parsed_from_resume_id: string | null;
  last_parsed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingSkill {
  skill: string;
  category: string;
  reason: string;
  confidence: "high" | "medium";
  status: "pending" | "accepted" | "rejected";
}

export async function findSoTByCandidateId(candidateId: string): Promise<SoTRow | null> {
  const row = await queryOne<any>(
    "SELECT * FROM candidate_source_of_truth WHERE candidate_id = $1",
    [candidateId]
  );
  if (!row) return null;
  return {
    ...row,
    confirmed_skills: row.confirmed_skills ?? [],
    pending_skills: row.pending_skills ?? [],
  };
}

export async function upsertSoT(candidateId: string, fields: Partial<SoTRow>): Promise<SoTRow> {
  const existing = await findSoTByCandidateId(candidateId);
  if (!existing) {
    const row = await queryOne<any>(
      `INSERT INTO candidate_source_of_truth (candidate_id, confirmed_skills, pending_skills, parsed_from_resume_id, last_parsed_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        candidateId,
        JSON.stringify(fields.confirmed_skills ?? []),
        JSON.stringify(fields.pending_skills ?? []),
        fields.parsed_from_resume_id ?? null,
        fields.last_parsed_at ?? null,
      ]
    );
    return {
      ...row,
      confirmed_skills: row.confirmed_skills ?? [],
      pending_skills: row.pending_skills ?? [],
    } as SoTRow;
  } else {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (fields.confirmed_skills !== undefined) {
      updates.push(`confirmed_skills = $${i++}`);
      values.push(JSON.stringify(fields.confirmed_skills));
    }
    if (fields.pending_skills !== undefined) {
      updates.push(`pending_skills = $${i++}`);
      values.push(JSON.stringify(fields.pending_skills));
    }
    if (fields.parsed_from_resume_id !== undefined) {
      updates.push(`parsed_from_resume_id = $${i++}`);
      values.push(fields.parsed_from_resume_id);
    }
    if (fields.last_parsed_at !== undefined) {
      updates.push(`last_parsed_at = $${i++}`);
      values.push(fields.last_parsed_at);
    }

    updates.push(`updated_at = NOW()`);
    values.push(candidateId);

    const row = await queryOne<any>(
      `UPDATE candidate_source_of_truth SET ${updates.join(", ")} WHERE candidate_id = $${i} RETURNING *`,
      values
    );
    return {
      ...row,
      confirmed_skills: row.confirmed_skills ?? [],
      pending_skills: row.pending_skills ?? [],
    } as SoTRow;
  }
}

export async function updatePendingSkills(candidateId: string, pendingSkills: PendingSkill[]): Promise<void> {
  await execute(
    "UPDATE candidate_source_of_truth SET pending_skills = $1, updated_at = NOW() WHERE candidate_id = $2",
    [JSON.stringify(pendingSkills), candidateId]
  );
}

export async function updateConfirmedSkills(candidateId: string, confirmedSkills: string[]): Promise<void> {
  await execute(
    "UPDATE candidate_source_of_truth SET confirmed_skills = $1, updated_at = NOW() WHERE candidate_id = $2",
    [JSON.stringify(confirmedSkills), candidateId]
  );
}
