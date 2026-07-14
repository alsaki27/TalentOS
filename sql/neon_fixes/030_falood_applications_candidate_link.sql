-- 030: link falood_saved_applications to a candidate so the chatbot studio's
-- AI can look up that candidate's base resumes/evidence for context (e.g.
-- "pull education from her base resume") instead of being stuck with
-- whatever was in the resume_data snapshot at session-creation time.
ALTER TABLE falood_saved_applications ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fsa_candidate_idx ON falood_saved_applications (candidate_id);
