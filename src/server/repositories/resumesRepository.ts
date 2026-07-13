// src/server/repositories/resumesRepository.ts
// Neon-only data-access for resumed table.
// The resumes table does NOT have a raw_text column; only parsed_json is returned.

import { queryOne } from "@/server/db/neon";

export async function findResumeParsedWithRawText(
  candidateId: string
): Promise<{ parsed_json: unknown } | null> {
  return queryOne<{ parsed_json: unknown }>(
    `SELECT parsed_json
     FROM resumes
     WHERE candidate_id = $1 AND is_original_upload = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [candidateId]
  );
}
