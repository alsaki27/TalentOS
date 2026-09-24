import { queryOne, execute } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";

/**
 * Every candidate gets a training-audit record — there is no "link this
 * candidate first" gate. The candidates matched to real historical Skarion
 * Student Audit data already have a student_audit_links row pointing at
 * their imported skr-* record; everyone else (including brand new
 * candidates) gets one auto-created here on first touch, keyed by their own
 * candidate id, starting at 0% / 0 sessions / 0 notes — exactly like adding
 * a new candidate in the original student-audit app.
 */
export async function ensureLinked(candidateId: string): Promise<string> {
  const existing = await queryOne<{ audit_student_id: string }>(
    `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
    [candidateId]
  );
  if (existing) {
    const stillExists = await queryOne(`SELECT 1 FROM student_audit_students WHERE id = $1`, [existing.audit_student_id]);
    if (stillExists) return existing.audit_student_id;
  }

  const candidate = await findCandidateById(candidateId);
  await execute(
    `INSERT INTO student_audit_students (id, name, domain, target_role, joining_date, progress, mock_interviews, rating)
     VALUES ($1, $2, $3, $3, CURRENT_DATE::text, 0, 0, 'good')
     ON CONFLICT (id) DO NOTHING`,
    [candidateId, candidate?.name ?? "Unnamed candidate", candidate?.target_roles ?? null]
  );
  await execute(
    `INSERT INTO student_audit_links (candidate_id, audit_student_id) VALUES ($1, $2)
     ON CONFLICT (candidate_id) DO UPDATE SET audit_student_id = EXCLUDED.audit_student_id`,
    [candidateId, candidateId]
  );
  return candidateId;
}
