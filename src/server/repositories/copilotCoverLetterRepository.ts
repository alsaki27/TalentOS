import { queryOne, execute } from "@/server/db/neon";

export interface CopilotCoverLetterRow {
  id: string;
  application_id: string;
  candidate_id: string | null;
  letter_text: string;
  created_at: string;
}

export async function findCoverLetter(applicationId: string): Promise<CopilotCoverLetterRow | null> {
  return queryOne<CopilotCoverLetterRow>(
    `SELECT * FROM copilot_cover_letters WHERE application_id = $1`,
    [applicationId]
  );
}

export async function upsertCoverLetter(
  applicationId: string,
  candidateId: string | null,
  letterText: string
): Promise<CopilotCoverLetterRow> {
  const row = await queryOne<CopilotCoverLetterRow>(
    `INSERT INTO copilot_cover_letters (application_id, candidate_id, letter_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id) DO UPDATE SET letter_text = $3, created_at = NOW()
     RETURNING *`,
    [applicationId, candidateId, letterText]
  );
  return row!;
}
