-- ============================================================
-- Extend application_packets with columns /api/application-packets and
-- /api/application-packets/[id] already assume exist.
--
-- Neon's application_packets was created with a minimal schema
-- (application_id, resume_version_id, two export FKs, packet_status,
-- packet_pdf_url, notes). These two pre-existing route files (used by
-- TailorResumeModal.tsx) were written against a richer design - keyword
-- approval tracking, cover letter / recruiter message / hiring manager
-- email / interview prep notes - that was never carried into Neon's
-- table. Every INSERT/UPDATE through these routes has been failing with
-- "column does not exist" since the Neon migration. Adding the missing
-- columns rather than rewriting the routes, since this is real, wanted
-- functionality, not dead code.
--
-- final_resume_version_id is a separate column from the existing
-- resume_version_id (used by /api/quick-application/falood-setup) -
-- they're conceptually similar (the resume version attached to a
-- packet) but were written independently against different column
-- names; left as two columns rather than merged, since unifying them
-- would mean rewriting call sites for both features.
-- ============================================================

ALTER TABLE application_packets
  ADD COLUMN IF NOT EXISTS base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_job_id uuid REFERENCES target_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_keyword_ids uuid[],
  ADD COLUMN IF NOT EXISTS rejected_keyword_ids uuid[],
  ADD COLUMN IF NOT EXISTS cover_letter text,
  ADD COLUMN IF NOT EXISTS recruiter_message text,
  ADD COLUMN IF NOT EXISTS hiring_manager_email text,
  ADD COLUMN IF NOT EXISTS interview_prep_notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL;
