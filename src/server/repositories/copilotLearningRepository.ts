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
  field_selector: string | null;
  field_type: string | null;  // radio | checkbox | select | combobox | text | etc.
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
    // Skip→fill transitions (AI had null/empty, user filled something) are
    // definitionally real corrections. Auto-mark them as ai_reviewed=true with
    // a fixed reason so the Correction Reviewer AI cannot downgrade them later
    // by mistaking them for "the AE simply adding something the AI wasn't asked to add".
    const isSkipToFill = (c.aiValue == null || normalize(c.aiValue) === "") &&
                         c.finalValue != null && normalize(c.finalValue) !== "";
    const aiReviewed = isSkipToFill ? true : false;
    const aiReviewReason = isSkipToFill
      ? "Auto-approved: AI had skipped this field (null/empty) and user explicitly filled it in."
      : null;

    const row = await query<{ id: string }>(
      `INSERT INTO copilot_fill_corrections
         (application_id, candidate_id, domain, field_label, field_selector, field_type,
          ai_value, ai_confidence, ai_reasoning, final_value, was_corrected,
          ai_reviewed, ai_review_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        c.applicationId, c.candidateId, c.domain, c.fieldLabel, c.fieldSelector, c.fieldType,
        c.aiValue, c.aiConfidence, c.aiReasoning, c.finalValue, wasCorrected,
        aiReviewed, aiReviewReason,
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
    `SELECT field_label, field_selector, field_type, ai_value, final_value, domain, was_corrected, created_at
     FROM copilot_fill_corrections
     WHERE domain = $1 AND was_corrected = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [domain, limit]
  );

  if (!candidateId) return domainRows;

  // Fetch candidate-level corrections from ALL domains (including the current one).
  // Previously this excluded domain = $2, which meant name/country/phone corrections
  // learned on the same ATS site were never reused on subsequent visits to that site.
  const candidateRows = await query<FillCorrectionRow>(
    `SELECT field_label, field_selector, field_type, ai_value, final_value, domain, was_corrected, created_at
     FROM copilot_fill_corrections
     WHERE candidate_id = $1 AND was_corrected = true
     ORDER BY created_at DESC
     LIMIT 20`,
    [candidateId]
  );

  // De-duplicate: domain rows take priority (they are more site-specific).
  // Candidate rows fill in any labels/selectors not already covered by domain rows.
  const seenLabels = new Set(domainRows.map((r) => (r.field_label ?? "").trim().toLowerCase()));
  const seenSelectors = new Set(domainRows.map((r) => r.field_selector ?? "").filter(Boolean));
  const extraCandidateRows = candidateRows.filter((r) => {
    const lbl = (r.field_label ?? "").trim().toLowerCase();
    const sel = r.field_selector ?? "";
    // Exclude if either label OR selector matches something we already have.
    if (lbl && seenLabels.has(lbl)) return false;
    if (sel && seenSelectors.has(sel)) return false;
    return true;
  });

  return [...domainRows, ...extraCandidateRows];
}
