-- Add base_resume_id to applications table so assignment tickets can track
-- which base resume to use for tailoring without forcing an uploaded file.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS applications_base_resume_idx ON applications (base_resume_id);
