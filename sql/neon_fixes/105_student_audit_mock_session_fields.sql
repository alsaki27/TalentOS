-- Structured mock-interview fields ported from skarion-student-audit's real
-- Log/Edit Mock Interview form (round type, score, feedback, strengths,
-- improvement) plus PDF attachment metadata (file itself lives in R2, not
-- this table — see src/server/storage/storageApi.ts).
ALTER TABLE student_audit_mock_sessions
  ADD COLUMN IF NOT EXISTS round_type text,
  ADD COLUMN IF NOT EXISTS feedback_summary text,
  ADD COLUMN IF NOT EXISTS strengths_noted text,
  ADD COLUMN IF NOT EXISTS areas_for_improvement text,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS pdf_filename text;
