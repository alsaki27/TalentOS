// src/server/repositories/baseResumesRepository.ts
// Neon-only data-access for base_resume table.

import { queryOne } from "@/server/db/neon";

export interface BaseResumeContentRow {
  id: string;
  content: unknown;
  name: string;
}

export async function findLatestBaseResumeFull(candidateId: string): Promise<BaseResumeContentRow | null> {
  return queryOne<BaseResumeContentRow>(
    `SELECT id, content, name
     FROM base_resumes
     WHERE candidate_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [candidateId]
  );
}
