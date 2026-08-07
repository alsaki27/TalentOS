// src/server/repositories/copilotLearningRepository.ts
// Read/write access to copilot_fill_corrections — the fill-plan learning loop.
// See neon/migrations/0005_copilot_fill_learning.sql.

import { query, execute } from "@/server/db/neon";

export interface FillCorrectionInput {
  applicationId: string | null;
  candidateId: string | null;
  domain: string;
  fieldLabel: string | null;
  fieldSelector: string | null;
  fieldType: string | null;
  aiValue: string | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  finalValue: string | null;
}

export interface FillCorrectionRow {
  field_label: string | null;
  ai_value: string | null;
  final_value: string | null;
  domain: string;
  was_corrected: boolean;
  created_at: string;
}

function normalize(v: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

export interface RecordedCorrection {
  id: string;
  wasCorrected: boolean;
  domain: string;
  fieldLabel: string | null;
  aiValue: string | null;
  finalValue: string | null;
}

export async function recordFillCorrections(inputs: FillCorrectionInput[]): Promise<RecordedCorrection[]> {
  const recorded: RecordedCorrection[] = [];
  for (const c of inputs) {
    const wasCorrected = normalize(c.aiValue) !== normalize(c.finalValue);
    const row = await query<{ id: string }>(
      `INSERT INTO copilot_fill_corrections
         (application_id, candidate_id, domain, field_label, field_selector, field_type,
          ai_value, ai_confidence, ai_reasoning, final_value, was_corrected)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        c.applicationId, c.candidateId, c.domain, c.fieldLabel, c.fieldSelector, c.fieldType,
        c.aiValue, c.aiConfidence, c.aiReasoning, c.finalValue, wasCorrected,
      ]
    );
    recorded.push({
      id: row[0].id,
      wasCorrected,
      domain: c.domain,
      fieldLabel: c.fieldLabel,
      aiValue: c.aiValue,
      finalValue: c.finalValue,
    });
  }
  return recorded;
}

// Correction Reviewer's async verdict on a single correction — may downgrade
// a false-positive was_corrected=true (e.g. formatting-only difference) so
// it stops being replayed as a learned example, and flags whether the
// mistake looks systematic enough for Copilot CEO to consider.
export async function applyCorrectionReview(
  id: string,
  verdict: { isRealCorrection: boolean; reason: string; shouldEscalateToCeo: boolean }
): Promise<void> {
  await execute(
    `UPDATE copilot_fill_corrections
     SET was_corrected = $1, ai_reviewed = true, ai_review_reason = $2, escalated_to_ceo = $3
     WHERE id = $4`,
    [verdict.isRealCorrection, verdict.reason, verdict.shouldEscalateToCeo, id]
  );
}

// Only *corrected* rows are useful as few-shot examples — rows where the AI
// already got it right just repeat what the prompt would have guessed anyway.
export async function getRecentCorrections(
  domain: string,
  candidateId: string | null,
  limit = 15
): Promise<FillCorrectionRow[]> {
  const domainRows = await query<FillCorrectionRow>(
    `SELECT field_label, ai_value, final_value, domain, was_corrected, created_at
     FROM copilot_fill_corrections
     WHERE domain = $1 AND was_corrected = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [domain, limit]
  );

  if (!candidateId) return domainRows;

  const candidateRows = await query<FillCorrectionRow>(
    `SELECT field_label, ai_value, final_value, domain, was_corrected, created_at
     FROM copilot_fill_corrections
     WHERE candidate_id = $1 AND was_corrected = true AND domain != $2
     ORDER BY created_at DESC
     LIMIT 10`,
    [candidateId, domain]
  );

  return [...domainRows, ...candidateRows];
}
