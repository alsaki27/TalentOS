-- 080_resume_final_scores.sql
-- Idempotent. Additive only. No seeds.
--
-- Post-pipeline final scoring (computed after ALL agents complete, on the
-- shipped resume — see src/lib/ai/application-agents/finalResumeScoring.ts)
-- persists recruiter fit and role fit next to the existing ats_score /
-- truth_score columns so the UI can show the real finished-resume numbers,
-- not the mid-pipeline draft scores.

ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS recruiter_score numeric;
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS role_fit_score numeric;
